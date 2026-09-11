console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "test", tools: ["Bash", "Read"] }));
console.log(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] }, session_id: "test" }));
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done", session_id: "test", total_cost_usd: 0.001, num_turns: 1, duration_ms: 10 }));
