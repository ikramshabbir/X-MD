/**
 * X-MD Admin HTTP + simple secure WhatsApp pairing portal.
 *
 * Flow:
 * Portal → PIN → WhatsApp number → Pairing code
 */

import http from "http";

import {
  getMetricsSnapshot,
  metricsPrometheus,
} from "./metrics.js";

import { queryAudit } from "./audit.js";
import { getFlags } from "./flags.js";
import { getPolicies } from "./policy.js";
import { queueStats } from "./queue.js";
import { getMode } from "../utils/access.js";

import {
  getLogGroupJid,
  isSetupDone,
} from "../utils/logGroup.js";

import { BOT_INFO } from "../config/constants.js";
import { checkFfmpeg } from "../onboarding/setup.js";
import logger from "../utils/logger.js";

import {
  getPairingInfo,
  requestPortalPairing,
} from "../socket/connection.js";

let server = null;

/* =========================
   Environment
========================= */

const portalPin =
  process.env.PORTAL_PIN || "";

const adminToken =
  process.env.ADMIN_HTTP_TOKEN || "";


/* =========================
   Helpers
========================= */

function auth(req, token) {
  if (!token) return false;

  const header =
    req.headers.authorization || "";

  if (header === `Bearer ${token}`) {
    return true;
  }

  const url = new URL(
    req.url || "/",
    "http://localhost"
  );

  return (
    url.searchParams.get("token") === token
  );
}


function json(res, code, body) {
  res.writeHead(code, {
    "Content-Type":
      "application/json; charset=utf-8",

    "Cache-Control":
      "no-store",
  });

  res.end(
    JSON.stringify(body, null, 2)
  );
}


function html(res, body) {
  res.writeHead(200, {
    "Content-Type":
      "text/html; charset=utf-8",

    "Cache-Control":
      "no-store",
  });

  res.end(body);
}


function readBody(req) {
  return new Promise(
    (resolve, reject) => {

      let body = "";

      req.on("data", (chunk) => {

        body += chunk;

        if (body.length > 10_000) {
          req.destroy();

          reject(
            new Error("Request too large")
          );
        }
      });

      req.on("end", () => {

        try {

          resolve(
            body
              ? JSON.parse(body)
              : {}
          );

        } catch {

          resolve({});
        }
      });

      req.on("error", reject);
    }
  );
}


/* =========================
   Portal HTML
========================= */

const portalHtml = `
<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1.0"
>

<title>X-MD WhatsApp Pairing</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;

  display: flex;
  align-items: center;
  justify-content: center;

  font-family:
    Arial,
    sans-serif;

  background:
    linear-gradient(
      135deg,
      #0f172a,
      #111827
    );

  color: white;

  padding: 20px;
}

.card {
  width: 100%;
  max-width: 430px;

  background: #1e293b;

  border-radius: 20px;

  padding: 28px;

  box-shadow:
    0 20px 60px
    rgba(0,0,0,.35);
}

.logo {
  text-align: center;

  font-size: 42px;

  margin-bottom: 8px;
}

h1 {
  text-align: center;

  margin: 0;

  font-size: 25px;
}

.sub {
  text-align: center;

  color: #94a3b8;

  margin:
    10px 0 25px;
}

label {
  display: block;

  margin-bottom: 8px;

  font-size: 14px;

  color: #cbd5e1;
}

input {
  width: 100%;

  padding: 14px;

  border:
    1px solid #475569;

  border-radius: 10px;

  background: #0f172a;

  color: white;

  font-size: 16px;

  outline: none;

  margin-bottom: 14px;
}

input:focus {
  border-color: #22c55e;
}

button {
  width: 100%;

  padding: 14px;

  border: 0;

  border-radius: 10px;

  background: #22c55e;

  color: white;

  font-size: 16px;

  font-weight: bold;

  cursor: pointer;
}

button:hover {
  background: #16a34a;
}

button:disabled {
  opacity: .5;

  cursor: not-allowed;
}

.result {
  display: none;

  margin-top: 22px;

  text-align: center;

  padding: 20px;

  border-radius: 14px;

  background: #0f172a;
}

.code {
  font-size: 30px;

  font-weight: bold;

  letter-spacing: 5px;

  margin: 15px 0;
}

.status {
  margin-top: 15px;

  padding: 10px;

  border-radius: 8px;

  background: #334155;

  color: #cbd5e1;
}

.small {
  font-size: 13px;

  color: #94a3b8;

  line-height: 1.5;
}

.error {
  color: #fca5a5;
}

.success {
  color: #86efac;
}

.hidden {
  display: none;
}

</style>

</head>

<body>

<div class="card">

  <div class="logo">
    🤖
  </div>

  <h1>
    X-MD WhatsApp
  </h1>

  <div class="sub">
    Secure WhatsApp Pairing
  </div>


  <!-- PIN -->

  <div id="loginBox">

    <label>
      Portal PIN
    </label>

    <input
      id="pin"
      type="password"
      placeholder="Enter PIN"
      autocomplete="off"
    >

    <button
      id="loginBtn"
      onclick="login()"
    >
      Continue
    </button>

  </div>


  <!-- Pairing -->

  <div
    id="pairBox"
    class="hidden"
  >

    <label>
      WhatsApp Number
    </label>

    <input
      id="number"
      type="tel"
      placeholder="923001234567"
      autocomplete="off"
    >

    <button
      id="pairBtn"
      onclick="requestPairing()"
    >
      Get Pairing Code
    </button>


    <div
      id="result"
      class="result"
    >

      <div class="small">
        Your pairing code:
      </div>

      <div
        id="code"
        class="code"
      >
        ----
      </div>

      <div class="small">
        WhatsApp → Linked devices →
        Link with phone number
      </div>

      <div
        id="status"
        class="status"
      >
        Waiting...
      </div>

    </div>

  </div>

</div>


<script>

let portalSession = "";


/* =========================
   Login
========================= */

async function login() {

  const pin =
    document
      .getElementById("pin")
      .value
      .trim();

  const button =
    document
      .getElementById("loginBtn");

  if (!pin) {

    alert(
      "Enter Portal PIN."
    );

    return;
  }

  button.disabled = true;

  button.textContent =
    "Checking...";

  try {

    const response =
      await fetch(
        "/api/portal-login",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            pin
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      throw new Error(
        data.error ||
        "Invalid PIN"
      );
    }

    portalSession =
      data.session;

    document
      .getElementById("loginBox")
      .classList.add("hidden");

    document
      .getElementById("pairBox")
      .classList.remove("hidden");

  } catch (error) {

    alert(
      error.message
    );

  } finally {

    button.disabled = false;

    button.textContent =
      "Continue";
  }
}


/* =========================
   Pairing
========================= */

async function requestPairing() {

  const number =
    document
      .getElementById("number")
      .value
      .replace(/\\D/g, "");

  const button =
    document
      .getElementById("pairBtn");

  const result =
    document
      .getElementById("result");

  const code =
    document
      .getElementById("code");

  const status =
    document
      .getElementById("status");


  if (!number) {

    alert(
      "Enter WhatsApp number with country code."
    );

    return;
  }


  if (!portalSession) {

    alert(
      "Please login first."
    );

    return;
  }


  button.disabled = true;

  button.textContent =
    "Generating code...";

  result.style.display =
    "block";

  code.textContent =
    "----";

  status.textContent =
    "Connecting to WhatsApp...";

  status.className =
    "status";


  try {

    const response =
      await fetch(
        "/api/pair",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "X-Portal-Session":
              portalSession
          },

          body: JSON.stringify({
            number
          })
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.error ||
        "Pairing failed"
      );
    }


    code.textContent =
      data.code || "----";


    status.textContent =
      "Enter this code in WhatsApp.";


    status.className =
      "status success";


  } catch (error) {

    code.textContent =
      "----";

    status.textContent =
      error.message;

    status.className =
      "status error";


  } finally {

    button.disabled = false;

    button.textContent =
      "Get Pairing Code";
  }
}

</script>

</body>
</html>
`;


/* =========================
   Portal Sessions
========================= */

const portalSessions =
  new Map();


function createSession() {

  const session =
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

  portalSessions.set(
    session,
    Date.now()
  );

  return session;
}


function validPortalSession(session) {

  if (!session) {
    return false;
  }

  const created =
    portalSessions.get(session);

  if (!created) {
    return false;
  }


  const expired =
    Date.now() - created >
    30 * 60 * 1000;


  if (expired) {

    portalSessions.delete(
      session
    );

    return false;
  }


  return true;
}


/* =========================
   Start HTTP Server
========================= */

export function startAdminHttp() {

  const port =
    Number(
      process.env.ADMIN_HTTP_PORT ||
      process.env.PORT ||
      0
    );


  if (!port) {

    logger.info?.(
      "Admin HTTP disabled"
    );

    return null;
  }


  const host =
    process.env.ADMIN_HTTP_HOST ||
    "0.0.0.0";


  if (!adminToken) {

    console.warn(
      "[admin-http] ADMIN_HTTP_TOKEN missing — refusing to start"
    );

    return null;
  }


  if (!portalPin) {

    console.warn(
      "[admin-http] PORTAL_PIN missing — portal login disabled"
    );

    return null;
  }


  server =
    http.createServer(
      async (req, res) => {

        try {

          const url =
            new URL(
              req.url || "/",
              `http://${host}`
            );

          const path =
            url.pathname;


          /* =====================
             Portal
          ===================== */

          if (
            path === "/" ||
            path === "/portal"
          ) {

            return html(
              res,
              portalHtml
            );
          }


          /* =====================
             Portal Login
          ===================== */

          if (
            path ===
              "/api/portal-login" &&
            req.method === "POST"
          ) {

            const body =
              await readBody(req);


            const pin =
              String(
                body.pin || ""
              ).trim();


            if (
              pin !== portalPin
            ) {

              return json(
                res,
                401,
                {
                  error:
                    "Invalid Portal PIN"
                }
              );
            }


            const session =
              createSession();


            return json(
              res,
              200,
              {
                ok: true,
                session
              }
            );
          }


          /* =====================
             Pairing
          ===================== */

          if (
            path === "/api/pair" &&
            req.method === "POST"
          ) {

            const session =
              req.headers[
                "x-portal-session"
              ];


            if (
              !validPortalSession(
                session
              )
            ) {

              return json(
                res,
                401,
                {
                  error:
                    "Portal session expired. Login again."
                }
              );
            }


            const body =
              await readBody(req);


            const number =
              String(
                body.number || ""
              ).replace(
                /\D/g,
                ""
              );


            if (!number) {

              return json(
                res,
                400,
                {
                  error:
                    "Invalid WhatsApp number"
                }
              );
            }


            /*
             * Basic WhatsApp number validation.
             */

            if (
              number.length < 10 ||
              number.length > 15
            ) {

              return json(
                res,
                400,
                {
                  error:
                    "Invalid WhatsApp number"
                }
              );
            }


            try {

              /*
               * IMPORTANT:
               *
               * WhatsApp session is created
               * from the WhatsApp number.
               *
               * Portal login session is ONLY
               * used for portal authentication.
               *
               * This allows different users
               * to create independent sessions.
               */

              const result =
                await requestPortalPairing(
                  number
                );


              return json(
                res,
                200,
                {
                  ok: true,

                  code:
                    result.code,

                  sessionId:
                    result.sessionId
                }
              );


            } catch (err) {

              return json(
                res,
                400,
                {
                  error:
                    err?.message ||
                    "Pairing failed"
                }
              );
            }
          }


          /* =====================
             Pairing Status
          ===================== */

          if (
            path ===
              "/api/pairing"
          ) {

            if (
              !auth(
                req,
                adminToken
              )
            ) {

              return json(
                res,
                401,
                {
                  error:
                    "unauthorized"
                }
              );
            }


            return json(
              res,
              200,
              getPairingInfo()
            );
          }


          /* =====================
             Health
          ===================== */

          if (
            path === "/health"
          ) {

            const ff =
              await checkFfmpeg();


            const pairing =
              getPairingInfo();


            return json(
              res,
              200,
              {
                ok: true,

                name:
                  BOT_INFO.NAME,

                version:
                  BOT_INFO.VERSION,

                mode:
                  await getMode(),

                ffmpeg:
                  ff.ok,

                setup:
                  await isSetupDone(),

                logGroup:
                  !!(
                    await getLogGroupJid()
                  ),

                queue:
                  queueStats(),

                connected:
                  !!pairing.connected,
              }
            );
          }


          /* =====================
             Admin API
          ===================== */

          if (
            !auth(
              req,
              adminToken
            )
          ) {

            return json(
              res,
              401,
              {
                error:
                  "unauthorized"
              }
            );
          }


          /* =====================
             Metrics
          ===================== */

          if (
            path === "/metrics" &&
            url.searchParams.get(
              "format"
            ) === "prom"
          ) {

            res.writeHead(
              200,
              {
                "Content-Type":
                  "text/plain; version=0.0.4",
              }
            );

            res.end(
              metricsPrometheus()
            );

            return;
          }


          if (
            path === "/metrics"
          ) {

            return json(
              res,
              200,
              getMetricsSnapshot()
            );
          }


          /* =====================
             Flags
          ===================== */

          if (
            path === "/flags"
          ) {

            return json(
              res,
              200,
              await getFlags()
            );
          }


          /* =====================
             Policies
          ===================== */

          if (
            path === "/policies"
          ) {

            return json(
              res,
              200,
              await getPolicies()
            );
          }


          /* =====================
             Audit
          ===================== */

          if (
            path === "/audit"
          ) {

            const limit =
              Number(
                url.searchParams.get(
                  "limit"
                ) || 50
              );


            const action =
              url.searchParams.get(
                "action"
              ) || undefined;


            return json(
              res,
              200,
              await queryAudit({
                limit,
                action,
              })
            );
          }


          /* =====================
             Not Found
          ===================== */

          return json(
            res,
            404,
            {
              error:
                "not_found"
            }
          );


        } catch (err) {

          console.error(
            "[admin-http]",
            err
          );


          return json(
            res,
            500,
            {
              error:
                err?.message ||
                "error"
            }
          );
        }
      }
    );


  server.listen(
    port,
    host,
    () => {

      console.log(
        `🌐 X-MD Portal running on http://${host}:${port}`
      );

      console.log(
        `🔐 Portal PIN protection enabled`
      );

      console.log(
        `🛡 Admin API protected by ADMIN_HTTP_TOKEN`
      );
    }
  );


  return server;
}


/* =========================
   Stop HTTP Server
========================= */

export function stopAdminHttp() {

  if (server) {

    server.close();

    server = null;
  }
}
