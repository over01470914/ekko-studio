import { execFileSync } from 'node:child_process'
import { describe, it } from 'vitest'

const harness = String.raw`
import sys
from pathlib import Path
sys.path.insert(0, str(Path("packages/server/src/modules/hermes/services/bridge/python").resolve()))
from bridge_report import run_read_only_report

class Agent:
    instances = []
    fail = False
    attempt_tool = False
    def __init__(self, *, skip_memory=False, skip_context_files=False,
                 skip_background_review=False, run_budget_seconds=None, **kwargs):
        self.options = dict(kwargs, skip_memory=skip_memory, skip_context_files=skip_context_files,
                            skip_background_review=skip_background_review, run_budget_seconds=run_budget_seconds)
        self.model = kwargs.get("model", "same-model")
        self.provider = kwargs.get("provider", "same-provider")
        self.session_id = kwargs.get("session_id", "original-session")
        self.closed = False
        self.instances.append(self)
    def run_conversation(self, message, **kwargs):
        assert self.tools == [] and self.valid_tool_names == set()
        assert self._persist_disabled and self._session_db is None
        assert self._skip_mcp_refresh and not self.compression_enabled
        assert self.options["max_iterations"] == 1 and self.options["max_tokens"] == 1536
        assert self.options["enabled_toolsets"] == []
        assert all(self.options[key] for key in ["skip_memory", "skip_context_files", "skip_background_review"])
        assert kwargs["task_id"] == "original-session"
        if self.attempt_tool:
            self._execute_tool_calls("malicious")
        if self.fail:
            raise RuntimeError("provider failed")
        kwargs["stream_callback"]("Reported")
        return {"final_response": "Reported", "messages": []}
    def close(self):
        self.closed = True
    def interrupt(self, reason):
        self.reason = reason

parent = Agent()
parent.tools = ["real-tool"]
agents, output = [], []
`

function run(script: string) {
  try {
    execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', harness + script], {
      encoding: 'utf8', timeout: 10_000,
    })
  } catch (error) {
    const detail = error as { message: string; stderr?: string; stdout?: string }
    throw new Error([detail.message, detail.stdout, detail.stderr].filter(Boolean).join('\n'))
  }
}

describe('native Hermes read-only report boundary', () => {
  it('uses the original model and session without mutating the interactive agent', () => run(String.raw`
result = run_read_only_report(parent, "evidence", "read only", [], output.append, agents.append)
assert result["final_response"] == "Reported"
assert output == ["Reported"]
assert parent.tools == ["real-tool"] and not parent.closed
assert agents[0].model == parent.model and agents[0].provider == parent.provider
assert agents[0].session_id == parent.session_id and agents[0].closed
assert agents[-1] is None
`))
  it.each(['fail', 'attempt_tool'])('fails closed on %s and always disposes the reporter', mode => run(String.raw`
Agent.${mode} = True
try:
    run_read_only_report(parent, "evidence", "read only", [], output.append, agents.append)
    raise AssertionError("Expected rejection")
except RuntimeError:
    pass
assert agents[0].closed and agents[-1] is None
assert parent.tools == ["real-tool"] and not parent.closed
`))
  it('rejects a runtime without the required isolation contract', () => run(String.raw`
class Legacy:
    pass
try:
    run_read_only_report(Legacy(), "evidence", "read only", [], output.append, agents.append)
    raise AssertionError("Expected rejection")
except RuntimeError as error:
    assert "does not support" in str(error)
assert agents == [] and output == []
`))
})
