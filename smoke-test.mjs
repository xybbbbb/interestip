import { startServer } from "./server.mjs";

const { server, port } = await startServer({ port: 0 });
const base = `http://127.0.0.1:${port}/mcp`;
let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}  ${detail}`);
  }
}

async function rpc(body, extraHeaders = {}) {
  const response = await fetch(base, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, text, json: text ? JSON.parse(text) : null };
}

try {
  // 1) initialize
  const init = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "interest-travel-assistant", version: "0.0.0" },
    },
  });
  check("initialize returns protocol version", init.json?.result?.protocolVersion === "2025-06-18");
  const sessionId = init.response.headers.get("mcp-session-id") || "";

  // 2) notifications/initialized
  const note = await rpc(
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    { "mcp-session-id": sessionId },
  );
  check("notifications/initialized accepted", note.response.status === 202);

  // 3) tools/list
  const listed = await rpc(
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { "mcp-session-id": sessionId },
  );
  const toolNames = (listed.json?.result?.tools || []).map((tool) => tool.name);
  check(
    "tools/list contains core tools",
    ["search_interest_places", "get_place_evidence", "list_demo_interests"].every(
      (name) => toolNames.includes(name),
    ),
    JSON.stringify(toolNames),
  );

  // 4) tools/call: search interest places
  const search = await rpc(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "search_interest_places",
        arguments: { interest: "CORTIS", city: "Seoul" },
      },
    },
    { "mcp-session-id": sessionId },
  );
  const searchResult = search.json?.result;
  const searchPayload = searchResult?.content?.[0]?.text
    ? JSON.parse(searchResult.content[0].text)
    : null;
  check("search returns places", searchPayload?.total > 0 && searchPayload?.places?.length > 0);
  check("search places include evidence count & confidence", Boolean(
    searchPayload?.places?.every(
      (place) => typeof place.evidenceCount === "number" && "confidence" in place,
    ),
  ));

  // 5) tools/call: get evidence of first returned place
  const firstPlace = searchPayload?.places?.[0];
  const evidence = await rpc(
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_place_evidence",
        arguments: { placeId: firstPlace?.placeId || "demo-seoul-001" },
      },
    },
    { "mcp-session-id": sessionId },
  );
  const evidencePayload = evidence.json?.result?.content?.[0]?.text
    ? JSON.parse(evidence.json.result.content[0].text)
    : null;
  check("evidence returns full chain", evidencePayload?.ok === true && Array.isArray(evidencePayload?.evidence));

  // 6) unknown tool returns JSON-RPC error
  const unknown = await rpc({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "not_a_tool", arguments: {} },
  });
  check("unknown tool handled", unknown.json?.error?.code === -32601);

  console.log("\nSample result preview (search_interest_places):");
  console.log(JSON.stringify(searchPayload?.places?.[0] || {}, null, 2).slice(0, 1200));
} finally {
  server.closeAllConnections?.();
  server.close();
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
