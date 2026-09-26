import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = "2025-06-18";
const HOST = process.env.INTEREST_MCP_HOST || "127.0.0.1";
const PORT = Number(process.env.INTEREST_MCP_PORT || 8788);

const dataFile = fileURLToPath(
  new URL("./data/seoul-cortis-demo.json", import.meta.url),
);
const demoData = JSON.parse(await readFile(dataFile, "utf8"));

function cleanPlaceForList(place) {
  return {
    placeId: place.id,
    name: place.name,
    nameLocal: place.nameLocal,
    type: place.type,
    category: place.category,
    interestRelated: place.interestRelated,
    address: place.address,
    district: place.district,
    latitude: place.latitude,
    longitude: place.longitude,
    openingHours: place.openingHours,
    description: place.description,
    imageUrl: place.imageUrl,
    tags: place.tags,
    evidenceCount: place.evidence.length,
    confidence: place.confidence,
    demo: demoData.demo,
  };
}

function normalizeText(value = "") {
  return String(value).toLowerCase().trim();
}

function matchesInterest(place, interest) {
  if (!interest) return true;
  const keyword = normalizeText(interest);
  const haystack = normalizeText(
    [
      place.name,
      place.nameLocal,
      place.description,
      ...(place.tags || []),
    ].join(" "),
  );
  return haystack.includes(keyword);
}

function matchesCategories(place, categories) {
  if (!Array.isArray(categories) || categories.length === 0) return true;
  const normalized = categories.map(normalizeText);
  const values = [
    place.type,
    place.category,
    place.interestRelated ? "interest" : "sightseeing",
  ].map(normalizeText);
  return normalized.some((category) =>
    values.some((value) => value.includes(category) || category.includes(value)),
  );
}

function toolResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: false,
  };
}

const tools = [
  {
    name: "search_interest_places",
    description:
      "按兴趣/艺人关键词在首尔查找关联地点（演出场馆、咖啡馆、MV 取景地、打卡点等），可叠加类型筛选；结果含地点、坐标、简介与证据概况。当前为演示数据集。",
    inputSchema: {
      type: "object",
      properties: {
        interest: {
          type: "string",
          description: "兴趣或艺人关键词，例如 CORTIS；不填则返回全部演示地点。",
        },
        city: {
          type: "string",
          description: "城市，当前仅支持 Seoul，默认 Seoul。",
        },
        categories: {
          type: "array",
          items: { type: "string" },
          description:
            "类型过滤，可选值例如 concert_venue / cafe / filming_location / photo_spot / normal_sightseeing；不填返回全部。",
        },
      },
    },
    handler(args) {
      const places = demoData.places.filter(
        (place) =>
          matchesInterest(place, args?.interest) &&
          matchesCategories(place, args?.categories),
      );
      return {
        query: {
          interest: args?.interest || null,
          city: args?.city || "Seoul",
          categories: args?.categories || [],
          demo: demoData.demo,
        },
        total: places.length,
        places: places.map(cleanPlaceForList),
        note: demoData.note,
      };
    },
  },
  {
    name: "get_place_evidence",
    description:
      "按 placeId 获取某个兴趣地点的完整证据链：每条证据包含来源类型（官方/媒体/社区）、链接、时间、置信度与摘要。",
    inputSchema: {
      type: "object",
      properties: {
        placeId: {
          type: "string",
          description: "兴趣地点 ID，例如 demo-seoul-001。",
        },
      },
      required: ["placeId"],
    },
    handler(args) {
      const place = demoData.places.find(
        (item) => item.id === args?.placeId,
      );
      if (!place) {
        return {
          ok: false,
          error: "PLACE_NOT_FOUND",
          note: `没有找到 placeId=${args?.placeId} 对应的演示地点。`,
        };
      }
      return {
        ok: true,
        placeId: place.id,
        name: place.name,
        confidence: place.confidence,
        interestRelated: place.interestRelated,
        evidence: place.evidence,
        demo: demoData.demo,
      };
    },
  },
  {
    name: "list_demo_interests",
    description: "列出当前演示数据里支持的兴趣关键词与地点分类，方便测试。",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler() {
      const interests = new Set();
      const categories = new Set();
      for (const place of demoData.places) {
        for (const tag of place.tags || []) interests.add(tag);
        categories.add(place.category);
      }
      return {
        demo: demoData.demo,
        interests: [...interests],
        categories: [...categories],
        note: demoData.note,
      };
    },
  },
];

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleRpc(message) {
  const method = message?.method;
  const id = message?.id;
  const params = message?.params || {};

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "interest-mcp",
          version: "0.1.0",
        },
      },
    };
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      },
    };
  }

  if (method === "tools/call") {
    const tool = tools.find((item) => item.name === params?.name);
    if (!tool) {
      return rpcError(id, -32601, `UNKNOWN_TOOL: ${params?.name}`);
    }
    try {
      const payload = tool.handler(params?.arguments || {});
      return {
        jsonrpc: "2.0",
        id,
        result: toolResult(payload),
      };
    } catch (error) {
      return rpcError(
        id,
        -32602,
        error instanceof Error ? error.message : "INVALID_ARGUMENTS",
      );
    }
  }

  return rpcError(id, -32601, `UNKNOWN_METHOD: ${method}`);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

function writeJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

export function startServer({ host = HOST, port = PORT } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && (request.url === "/" || request.url === "/health")) {
        writeJson(response, 200, {
          ok: true,
          service: "interest-mcp",
          version: "0.1.0",
          demo: demoData.demo,
          endpoint: "/mcp",
        });
        return;
      }

      if (request.method !== "POST" || request.url !== "/mcp") {
        writeJson(response, 404, { error: "NOT_FOUND" });
        return;
      }

      const message = await readBody(request);
      if (!message) {
        writeJson(response, 400, { error: "EMPTY_BODY" });
        return;
      }

      const result = await handleRpc(message);
      if (result === null) {
        // notifications/initialized：按 MCP 习惯返回 202 且无正文
        response.writeHead(202, {
          "content-type": "application/json",
          "content-length": 0,
        });
        response.end();
        return;
      }

      const isInitialize = message.method === "initialize";
      const headers = { "content-type": "application/json" };
      if (isInitialize) {
        headers["mcp-session-id"] = randomUUID();
      }
      const payload = JSON.stringify(result);
      headers["content-length"] = Buffer.byteLength(payload);
      headers["cache-control"] = "no-store";
      response.writeHead(200, headers);
      response.end(payload);
    } catch (error) {
      writeJson(response, 500, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "INTERNAL_ERROR",
        },
      });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        host,
        port: typeof address === "object" && address ? address.port : port,
      });
    });
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const { server, port } = await startServer();
  console.log(`[interest-mcp] listening on http://${HOST}:${port}/mcp`);
  console.log("[interest-mcp] demo dataset loaded:", demoData.places.length, "places");
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
