import inspect
import threading


def run_read_only_report(parent, message, instructions, history, stream_callback, on_agent):
    if not isinstance(message, str) or len(message) > 6000 or not isinstance(instructions, str) or len(instructions) > 2000:
        raise RuntimeError("Invalid read-only report input")
    history = history or []
    if len(history) > 6 or any(
        item.get("role") not in {"user", "assistant"} or not isinstance(item.get("content"), str)
        or len(item["content"]) > 500 for item in history
    ):
        raise RuntimeError("Invalid read-only report history")
    required = {"skip_memory", "skip_context_files", "skip_background_review", "run_budget_seconds"}
    if not required.issubset(inspect.signature(type(parent)).parameters):
        raise RuntimeError("Hermes runtime does not support bounded read-only reports")
    reporter = type(parent)(
        model=parent.model,
        provider=parent.provider,
        api_mode=getattr(parent, "api_mode", None),
        base_url=getattr(parent, "base_url", None),
        api_key=getattr(parent, "api_key", None),
        credential_pool=getattr(parent, "credential_pool", None),
        session_id=parent.session_id,
        session_db=None,
        enabled_toolsets=[],
        max_iterations=1,
        max_tokens=1536,
        run_budget_seconds=90,
        skip_memory=True,
        skip_context_files=True,
        skip_background_review=True,
        quiet_mode=True,
    )
    reporter.tools = []
    reporter.valid_tool_names = set()
    reporter._tool_snapshot_generation = 2147483647
    reporter._skip_mcp_refresh = True
    reporter._persist_disabled = True
    reporter._session_db = None
    reporter._end_session_on_close = False
    reporter.compression_enabled = False

    def deny_tools(*args, **kwargs):
        raise RuntimeError("Tools are disabled for read-only reports")

    reporter._execute_tool_calls = deny_tools
    reporter._execute_tool_calls_sequential = deny_tools
    reporter._execute_tool_calls_concurrent = deny_tools
    expired = threading.Event()
    streamed = False

    def stream(delta):
        nonlocal streamed
        streamed = streamed or bool(delta)
        stream_callback(delta)

    def expire():
        expired.set()
        reporter.interrupt("Read-only report deadline")

    timer = threading.Timer(90, expire)
    timer.daemon = True
    on_agent(reporter)
    timer.start()
    try:
        result = reporter.run_conversation(
            message,
            system_message=instructions,
            conversation_history=history,
            task_id=parent.session_id,
            stream_callback=stream,
        )
        if expired.is_set():
            raise RuntimeError("Read-only report deadline exceeded")
        if not streamed and isinstance(result, dict) and result.get("final_response"):
            stream_callback(str(result["final_response"]))
        return result
    finally:
        timer.cancel()
        on_agent(None)
        reporter.close()
