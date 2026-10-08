#include <node_api.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <stdio.h>
#include <errno.h>
#include <string.h>
#include <stdint.h>

// Internal N-API seam: only single-component, dirfd-relative operations. No
// absolute paths, shell, cwd mutation, or symlink-following fallback lives here.
static napi_value failure_code(napi_env env, const char *code) {
  napi_value text, result;
  napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &text);
  napi_create_error(env, NULL, text, &result);
  napi_set_named_property(env, result, "code", text);
  napi_throw(env, result);
  return NULL;
}
static napi_value failure(napi_env env, int error) {
  return failure_code(env, error == ENOENT ? "ENOENT" : error == EEXIST ? "EEXIST" :
    error == ELOOP ? "ELOOP" : error == ENOTDIR ? "ENOTDIR" : error == EXDEV ? "EXDEV" :
    error == EBADF ? "EBADF" : error == EINVAL ? "EINVAL" : "EIO");
}
static int number(napi_env env, napi_value value, int *out) {
  return napi_get_value_int32(env, value, out) == napi_ok;
}
static int name(napi_env env, napi_value value, char *out) {
  size_t size;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &size) != napi_ok || size > 511) return 0;
  if (napi_get_value_string_utf8(env, value, out, 513, &size) != napi_ok || size == 0 || size > 511 ||
      strlen(out) != size || strchr(out, '/') || !strcmp(out, ".") || !strcmp(out, "..")) return 0;
  return 1;
}
static int args(napi_env env, napi_callback_info info, size_t count, napi_value *values) {
  size_t actual = count;
  return napi_get_cb_info(env, info, &actual, values, NULL, NULL) == napi_ok && actual == count;
}
static napi_value integer(napi_env env, double value) {
  napi_value result; napi_create_double(env, value, &result); return result;
}
static napi_value identity(napi_env env, uint64_t value) {
  napi_value result; napi_create_bigint_uint64(env, value, &result); return result;
}
static void flag(napi_env env, napi_value object, const char *key, int value) {
  napi_value result; napi_get_boolean(env, value, &result); napi_set_named_property(env, object, key, result);
}
static napi_value open_at(napi_env env, napi_callback_info info) {
  napi_value values[3]; int fd, flags; char file[513];
  if (!args(env, info, 3, values) || !number(env, values[0], &fd) || !name(env, values[1], file) || !number(env, values[2], &flags)) return failure(env, EINVAL);
  // Never open an existing file for writing, even if an internal caller errs.
  if ((flags & O_ACCMODE) != O_RDONLY && (!(flags & O_CREAT) || !(flags & O_EXCL))) return failure(env, EINVAL);
  int result = openat(fd, file, flags | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0600);
  if (result < 0) return failure(env, errno);
  return integer(env, result);
}
static napi_value stat_at(napi_env env, napi_callback_info info) {
  napi_value values[2], result; int fd; char file[513]; struct stat st;
  if (!args(env, info, 2, values) || !number(env, values[0], &fd) || !name(env, values[1], file)) return failure(env, EINVAL);
  if (fstatat(fd, file, &st, AT_SYMLINK_NOFOLLOW) < 0) return failure(env, errno);
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "dev", identity(env, (uint64_t)st.st_dev));
  napi_set_named_property(env, result, "ino", identity(env, (uint64_t)st.st_ino));
  napi_set_named_property(env, result, "nlink", integer(env, st.st_nlink));
  napi_set_named_property(env, result, "size", integer(env, st.st_size));
  flag(env, result, "file", S_ISREG(st.st_mode)); flag(env, result, "directory", S_ISDIR(st.st_mode)); flag(env, result, "symlink", S_ISLNK(st.st_mode));
  return result;
}
typedef struct {
  uint64_t dev, ino;
  int64_t size, mtime_ns, ctime_ns;
  const unsigned char *bytes;
  size_t length;
} revision;
static int uint_field(napi_env env, napi_value value, const char *key, uint64_t *out) {
  napi_value field; bool lossless;
  return napi_get_named_property(env, value, key, &field) == napi_ok &&
    napi_get_value_bigint_uint64(env, field, out, &lossless) == napi_ok && lossless;
}
static int int_field(napi_env env, napi_value value, const char *key, int64_t *out) {
  napi_value field; bool lossless;
  return napi_get_named_property(env, value, key, &field) == napi_ok &&
    napi_get_value_bigint_int64(env, field, out, &lossless) == napi_ok && lossless;
}
static int parse_revision(napi_env env, napi_value value, revision *out) {
  napi_value bytes; bool buffer; void *data;
  if (!uint_field(env, value, "dev", &out->dev) || !uint_field(env, value, "ino", &out->ino) ||
      !int_field(env, value, "size", &out->size) || !int_field(env, value, "mtimeNs", &out->mtime_ns) ||
      !int_field(env, value, "ctimeNs", &out->ctime_ns) || out->size < 0 || out->size > 65536 ||
      napi_get_named_property(env, value, "bytes", &bytes) != napi_ok ||
      napi_is_buffer(env, bytes, &buffer) != napi_ok || !buffer ||
      napi_get_buffer_info(env, bytes, &data, &out->length) != napi_ok || out->length != (size_t)out->size) return 0;
  out->bytes = data;
  return 1;
}
static int time_matches(struct timespec time, int64_t ns) {
  int64_t seconds = ns / 1000000000, nanos = ns % 1000000000;
  if (nanos < 0) { seconds--; nanos += 1000000000; }
  return time.tv_sec == seconds && time.tv_nsec == nanos;
}
static int matches_revision(const struct stat *stat, const revision *expected) {
#ifdef __APPLE__
  struct timespec mtime = stat->st_mtimespec, ctime = stat->st_ctimespec;
#else
  struct timespec mtime = stat->st_mtim, ctime = stat->st_ctim;
#endif
  return S_ISREG(stat->st_mode) && stat->st_nlink == 1 && (uint64_t)stat->st_dev == expected->dev &&
    (uint64_t)stat->st_ino == expected->ino && stat->st_size == expected->size &&
    time_matches(mtime, expected->mtime_ns) && time_matches(ctime, expected->ctime_ns);
}
// -1 is a proven pre-apply mismatch, never emitted after a mutation syscall.
static int check_current(int parent, const char *file, int fd, const revision *expected) {
  struct stat opened, named;
  if (fstat(fd, &opened) < 0) return errno;
  if (fstatat(parent, file, &named, AT_SYMLINK_NOFOLLOW) < 0) return errno == ENOENT ? -1 : errno;
  return matches_revision(&opened, expected) && matches_revision(&named, expected) ? 0 : -1;
}
static int check_file(int parent, const char *file, const revision *expected, int *fd) {
  struct stat named;
  if (fstatat(parent, file, &named, AT_SYMLINK_NOFOLLOW) < 0) return errno == ENOENT ? -1 : errno;
  if (!matches_revision(&named, expected)) return -1;
  *fd = openat(parent, file, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
  if (*fd < 0) return errno == ENOENT || errno == ELOOP ? -1 : errno;
  int error = check_current(parent, file, *fd, expected);
  if (error) return error;
  unsigned char chunk[4096]; size_t offset = 0;
  while (offset < expected->length) {
    size_t count = expected->length - offset;
    if (count > sizeof(chunk)) count = sizeof(chunk);
    ssize_t read = pread(*fd, chunk, count, (off_t)offset);
    if (read < 0) { if (errno == EINTR) continue; return errno; }
    if (!read || memcmp(chunk, expected->bytes + offset, (size_t)read)) return -1;
    offset += (size_t)read;
  }
  return check_current(parent, file, *fd, expected);
}
static int check_absent(int parent, const char *file) {
  struct stat stat;
  if (fstatat(parent, file, &stat, AT_SYMLINK_NOFOLLOW) == 0) return EEXIST;
  return errno == ENOENT ? 0 : errno;
}
static napi_value transfer(napi_env env, napi_callback_info info, int rename_file) {
  napi_value values[6]; int from, to; char source[513], target[513]; revision src, dst;
  napi_valuetype target_type;
  if (!args(env, info, 6, values) || !number(env, values[0], &from) || !name(env, values[1], source) ||
      !number(env, values[2], &to) || !name(env, values[3], target) || !parse_revision(env, values[4], &src) ||
      napi_typeof(env, values[5], &target_type) != napi_ok) return failure(env, EINVAL);
  int has_target = target_type != napi_null;
  if (has_target && (!rename_file || !parse_revision(env, values[5], &dst))) return failure(env, EINVAL);
  int source_fd = -1, target_fd = -1;
  int error = check_file(from, source, &src, &source_fd);
  if (!error) error = has_target ? check_file(to, target, &dst, &target_fd) : check_absent(to, target);
  // Recheck both named/opened revisions after bounded byte comparisons, at the
  // last native boundary. POSIX rename itself is not a filesystem-wide CAS.
  if (!error) error = check_current(from, source, source_fd, &src);
  if (!error) error = has_target ? check_current(to, target, target_fd, &dst) : check_absent(to, target);
  if (!error && (rename_file ? renameat(from, source, to, target) : linkat(from, source, to, target, 0)) < 0) error = errno;
  if (source_fd >= 0) close(source_fd);
  if (target_fd >= 0) close(target_fd);
  if (error == -1) return failure_code(env, "REVISION_MISMATCH");
  if (error) return failure(env, error);
  return integer(env, 0);
}
static napi_value link_at(napi_env env, napi_callback_info info) { return transfer(env, info, 0); }
static napi_value rename_at(napi_env env, napi_callback_info info) { return transfer(env, info, 1); }
static napi_value unlink_at(napi_env env, napi_callback_info info) {
  napi_value values[2]; int fd; char file[513];
  if (!args(env, info, 2, values) || !number(env, values[0], &fd) || !name(env, values[1], file)) return failure(env, EINVAL);
  if (unlinkat(fd, file, 0) < 0) return failure(env, errno);
  return integer(env, 0);
}
static napi_value entries(napi_env env, napi_callback_info info) {
  napi_value values[2], result, list; int fd, max;
  if (!args(env, info, 2, values) || !number(env, values[0], &fd) || !number(env, values[1], &max) || max < 1 || max > 1001) return failure(env, EINVAL);
  int copy = dup(fd); if (copy < 0) return failure(env, errno);
  DIR *dir = fdopendir(copy); if (!dir) { int error = errno; close(copy); return failure(env, error); }
  rewinddir(dir); napi_create_array(env, &list); int count = 0, more = 0, error = 0;
  for (;;) {
    errno = 0; struct dirent *entry = readdir(dir);
    if (!entry) { error = errno; break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (count == max) { more = 1; break; }
    napi_value value; napi_create_string_utf8(env, entry->d_name, NAPI_AUTO_LENGTH, &value);
    napi_set_element(env, list, count++, value);
  }
  closedir(dir); if (error) return failure(env, error);
  napi_create_object(env, &result); napi_set_named_property(env, result, "names", list); flag(env, result, "hasMore", more);
  return result;
}
static napi_value init(napi_env env, napi_value exports) {
  napi_set_named_property(env, exports, "abiVersion", integer(env, 2));
  napi_property_attributes attributes = napi_writable | napi_configurable | napi_enumerable;
  napi_property_descriptor methods[] = {
    {"openAt", NULL, open_at, NULL, NULL, NULL, attributes, NULL},
    {"statAt", NULL, stat_at, NULL, NULL, NULL, attributes, NULL},
    {"linkAt", NULL, link_at, NULL, NULL, NULL, attributes, NULL},
    {"renameAt", NULL, rename_at, NULL, NULL, NULL, attributes, NULL},
    {"unlinkAt", NULL, unlink_at, NULL, NULL, NULL, attributes, NULL},
    {"entries", NULL, entries, NULL, NULL, NULL, attributes, NULL}
  };
  napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
