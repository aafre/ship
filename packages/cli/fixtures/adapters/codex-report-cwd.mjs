console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-thread-test", cwd: process.cwd() }));
console.log(JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "ok" } }));
console.log(JSON.stringify({ type: "turn.completed" }));
