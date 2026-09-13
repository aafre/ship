console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-thread-test" }));
setTimeout(() => {
  console.log(JSON.stringify({ type: "turn.completed" }));
}, 8000);
