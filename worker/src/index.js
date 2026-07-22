/**
 * Snacko menu editor Worker.
 *
 * Holds the GitHub token and the shared edit password so neither ever reaches
 * the browser. Two endpoints:
 *
 *   POST /verify  { pass }                  -> 200 | 401
 *   POST /save    { pass, menu, summary }   -> 200 { commit } | 4xx | 5xx
 *
 * Every response, including every error response, carries CORS headers.
 */

const MAX_NAME = 60;
const MAX_DESC = 200;
const MAX_LABEL = 60;
const MAX_CATEGORIES = 40;
const MAX_ITEMS = 200;
const MAX_SUMMARY = 72;

/* Rate limiting for /verify. Per-isolate and in-memory, so it is a speed bump
   rather than a guarantee — Cloudflare may run several isolates. That is enough
   to blunt naive guessing without pulling in KV or a Durable Object. */
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const FAILURE_LIMIT = 8;
const LOCKOUT_MS = 5 * 60 * 1000;
const failures = new Map(); // ip -> { count, first, until }

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }
    if (!originAllowed(request, env)) {
      return json({ error: "Forbidden origin" }, 403, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Body must be JSON" }, 400, cors);
    }

    if (url.pathname === "/verify") return handleVerify(request, env, body, cors);
    if (url.pathname === "/save")   return handleSave(request, env, body, cors);
    return json({ error: "Not found" }, 404, cors);
  },
};

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

async function handleVerify(request, env, body, cors) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const lock = lockoutRemaining(ip);
  if (lock > 0) {
    return json(
      { error: `Too many attempts. Try again in ${Math.ceil(lock / 60000)} minute(s).` },
      429,
      cors
    );
  }

  const ok = await passwordMatches(body && body.pass, env.EDIT_PASSWORD);
  if (!ok) {
    recordFailure(ip);
    return json({ error: "Incorrect password" }, 401, cors);
  }
  clearFailures(ip);
  return json({ ok: true }, 200, cors);
}

async function handleSave(request, env, body, cors) {
  /* Password first, before touching anything else. */
  if (!(await passwordMatches(body && body.pass, env.EDIT_PASSWORD))) {
    return json({ error: "Incorrect password" }, 401, cors);
  }

  /* The client is a page we wrote, and we still do not trust it. */
  const problems = validateMenu(body && body.menu);
  if (problems.length) {
    return json({ error: "Menu rejected: " + problems[0], problems }, 400, cors);
  }

  const json2 = JSON.stringify(body.menu, null, 2) + "\n";
  const content = base64Utf8(json2);
  const message = commitMessage(body && body.summary);

  try {
    const commit = await putFile(env, content, message);
    return json({ commit }, 200, cors);
  } catch (err) {
    return json({ error: err.message || "GitHub write failed" }, 502, cors);
  }
}

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

const GH_PATH = "menu.json";

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    /* Workers do not set a User-Agent, and GitHub answers a missing one with a
       confusing 403. */
    "User-Agent": "snacko-menu-editor",
    "Content-Type": "application/json",
  };
}

async function currentSha(env) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GH_REPO}/contents/${GH_PATH}`,
    { headers: ghHeaders(env) }
  );
  if (res.status === 404) return null;          // first write creates the file
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  const data = await res.json();
  return data.sha;
}

async function putFile(env, content, message) {
  let sha = await currentSha(env);
  let res = await writeOnce(env, content, message, sha);

  /* 409 means someone else committed between our read and our write. */
  if (res.status === 409) {
    sha = await currentSha(env);
    res = await writeOnce(env, content, message, sha);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body && body.message ? `: ${body.message}` : "";
    } catch { /* non-JSON error body */ }
    throw new Error(`GitHub write failed (${res.status})${detail}`);
  }
  const data = await res.json();
  return data.commit && data.commit.sha;
}

function writeOnce(env, content, message, sha) {
  const payload = { message, content };
  if (sha) payload.sha = sha;
  return fetch(
    `https://api.github.com/repos/${env.GH_REPO}/contents/${GH_PATH}`,
    { method: "PUT", headers: ghHeaders(env), body: JSON.stringify(payload) }
  );
}

/* ------------------------------------------------------------------ */
/* Validation — mirrors the schema in snacko-editor-spec.md            */
/* ------------------------------------------------------------------ */

function validateMenu(menu) {
  const problems = [];
  const fail = m => { problems.push(m); };

  if (!menu || typeof menu !== "object" || Array.isArray(menu)) {
    return ["menu must be an object"];
  }
  if (typeof menu.name !== "string" || menu.name.trim() === "") {
    fail("name is required");
  } else if (menu.name.trim().length > MAX_NAME) {
    fail(`name must be ${MAX_NAME} characters or fewer`);
  }
  if (typeof menu.venmoUsername !== "string" || menu.venmoUsername.trim() === "") {
    fail("venmoUsername is required");
  }
  if (!Array.isArray(menu.categories) || menu.categories.length === 0) {
    return problems.concat("at least one category is required");
  }
  if (menu.categories.length > MAX_CATEGORIES) {
    fail(`no more than ${MAX_CATEGORIES} categories`);
  }

  const seen = new Set();
  menu.categories.forEach((cat, ci) => {
    const where = `category ${ci + 1}`;
    if (!cat || typeof cat !== "object" || Array.isArray(cat)) {
      fail(`${where} must be an object`);
      return;
    }
    if (typeof cat.label !== "string" || cat.label.trim() === "") {
      fail(`${where} needs a name`);
    } else {
      const key = cat.label.trim().toLowerCase();
      if (key.length > MAX_LABEL) fail(`${where} name is too long`);
      if (seen.has(key)) fail(`two categories are both named "${cat.label.trim()}"`);
      seen.add(key);
    }
    if (!Array.isArray(cat.items)) {
      fail(`${where} must have an items list`);
      return;
    }
    if (cat.items.length > MAX_ITEMS) fail(`${where} has too many items`);
    cat.items.forEach((item, ii) => {
      validateItem(item, `${where}, item ${ii + 1}`, fail);
    });
  });

  return problems;
}

function validateItem(item, where, fail) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    fail(`${where} must be an object`);
    return;
  }
  if (typeof item.name !== "string" || item.name.trim() === "") {
    fail(`${where} needs a name`);
  } else if (item.name.trim().length > MAX_NAME) {
    fail(`${where} name must be ${MAX_NAME} characters or fewer`);
  }

  if (typeof item.price !== "number" || !Number.isFinite(item.price)) {
    fail(`${where} needs a price`);
  } else if (item.price < 0) {
    fail(`${where} price cannot be negative`);
  } else if (Math.abs(item.price * 100 - Math.round(item.price * 100)) > 1e-6) {
    /* Tolerance, not equality: 0.89 * 100 is 89.00000000000001 in binary float. */
    fail(`${where} price can have at most 2 decimal places`);
  }

  if (item.description !== undefined) {
    if (typeof item.description !== "string") {
      fail(`${where} description must be text`);
    } else if (item.description.length > MAX_DESC) {
      fail(`${where} description must be ${MAX_DESC} characters or fewer`);
    }
  }

  if (item.hidden !== undefined && typeof item.hidden !== "boolean") {
    fail(`${where} hidden must be true or false`);
  }

  if (item.sale !== undefined && item.sale !== null) {
    const s = item.sale;
    if (typeof s !== "object" || Array.isArray(s)) {
      fail(`${where} sale must be an object`);
      return;
    }
    if (!Number.isInteger(s.percentOff) || s.percentOff < 1 || s.percentOff > 99) {
      fail(`${where} sale percent must be a whole number from 1 to 99`);
    }
    if (s.until !== undefined && s.until !== null && s.until !== "") {
      if (typeof s.until !== "string" || !isCalendarDate(s.until)) {
        fail(`${where} sale end date must look like 2026-08-01`);
      }
    }
  }
}

function isCalendarDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;              // non-browser client; the password still gates it
  return origin === env.ALLOWED_ORIGIN;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

/* Constant-time comparison, so a wrong guess leaks neither length nor prefix. */
async function passwordMatches(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string") return false;
  const enc = new TextEncoder();
  const a = await crypto.subtle.digest("SHA-256", enc.encode(candidate));
  const b = await crypto.subtle.digest("SHA-256", enc.encode(expected));
  const av = new Uint8Array(a), bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0 && expected.length > 0;
}

/* btoa() throws on any non-Latin1 character, which an item name will eventually
   contain. Encode to UTF-8 bytes first, in chunks so a long file cannot blow the
   argument limit on spread. */
function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/* The summary is untrusted text: strip newlines, collapse space, truncate. */
function commitMessage(summary) {
  const clean = String(summary == null ? "" : summary)
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUMMARY);
  return clean ? `Menu update: ${clean}` : "Menu update";
}

function lockoutRemaining(ip) {
  const rec = failures.get(ip);
  if (!rec || !rec.until) return 0;
  const left = rec.until - Date.now();
  if (left <= 0) { failures.delete(ip); return 0; }
  return left;
}

function recordFailure(ip) {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || now - rec.first > FAILURE_WINDOW_MS) {
    failures.set(ip, { count: 1, first: now, until: 0 });
    return;
  }
  rec.count++;
  if (rec.count >= FAILURE_LIMIT) {
    rec.until = now + LOCKOUT_MS;
    rec.count = 0;
    rec.first = now;
  }
}

function clearFailures(ip) {
  failures.delete(ip);
}
