console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-thread-test" }));
console.log(JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "sandbox denied write" } }));
console.log(JSON.stringify({ type: "turn.failed", error: { message: "sandbox denied write" } }));
