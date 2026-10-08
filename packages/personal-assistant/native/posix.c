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
static napi_value failure(napi_env env, int error) {
  const char *code = error == ENOENT ? "ENOENT" : error == EEXIST ? "EEXIST" :
    error == ELOOP ? "ELOOP" : error == ENOTDIR ? "ENOTDIR" : error == EXDEV ? "EXDEV" :
    error == EBADF ? "EBADF" : error == EINVAL ? "EINVAL" : "EIO";
  napi_value text, result;
  napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &text);
  napi_create_error(env, NULL, text, &result);
  napi_set_named_property(env, result, "code", text);
  napi_throw(env, result);
  return NULL;
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
static napi_value transfer(napi_env env, napi_callback_info info, int rename_file) {
  napi_value values[4]; int from, to; char source[513], target[513];
  if (!args(env, info, 4, values) || !number(env, values[0], &from) || !name(env, values[1], source) ||
      !number(env, values[2], &to) || !name(env, values[3], target)) return failure(env, EINVAL);
  struct stat src, dst;
  if (fstatat(from, source, &src, AT_SYMLINK_NOFOLLOW) < 0) return failure(env, errno);
  if (!S_ISREG(src.st_mode) || src.st_nlink != 1) return failure(env, ELOOP);
  if (rename_file) {
    if (fstatat(to, target, &dst, AT_SYMLINK_NOFOLLOW) == 0) {
      if (!S_ISREG(dst.st_mode) || dst.st_nlink != 1) return failure(env, ELOOP);
    } else if (errno != ENOENT) return failure(env, errno);
  }
  int result = rename_file ? renameat(from, source, to, target) : linkat(from, source, to, target, 0);
  if (result < 0) return failure(env, errno);
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
