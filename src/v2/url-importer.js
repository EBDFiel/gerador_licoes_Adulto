"use strict";

const dns = require("dns").promises;
const net = require("net");

const MAX_BYTES = Number(process.env.EBD_V2_IMPORT_MAX_BYTES || 2_500_000);
const MAX_REDIRECTS = Number(process.env.EBD_V2_IMPORT_MAX_REDIRECTS || 4);
const TIMEOUT_MS = Number(process.env.EBD_V2_IMPORT_TIMEOUT_MS || 20000);

function isPrivateIp(address) {
  if (!address || !net.isIP(address)) return false;
  if (address === "127.0.0.1" || address === "::1") return true;
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;
  if (address.startsWith("169.254.")) return true;
  if (address.startsWith("172.")) {
    const second = Number(address.split(".")[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  return false;
}

async function assertSafeUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("URL inválida.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Somente links HTTP ou HTTPS são permitidos.");
  const hostname = url.hostname.toLowerCase();
  if (["localhost", "0.0.0.0"].includes(hostname) || hostname.endsWith(".local")) throw new Error("Endereço local não permitido.");
  if (net.isIP(hostname) && isPrivateIp(hostname)) throw new Error("Endereço IP privado não permitido.");
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length) throw new Error("Não foi possível resolver o domínio.");
  if (addresses.some((item) => isPrivateIp(item.address))) throw new Error("O domínio aponta para uma rede privada e foi bloqueado.");
  return url;
}

async function readLimitedBody(response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength && contentLength > MAX_BYTES) throw new Error("A página é maior que o limite permitido.");
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error("A página é maior que o limite permitido.");
    return buffer.toString("utf8");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error("A página é maior que o limite permitido.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchSafe(urlString, redirectCount = 0) {
  const url = await assertSafeUrl(urlString);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "EBD-Fiel-Admin-V2/1.0 (+https://ebdfiel.com.br)",
        Accept: "text/html,text/plain;q=0.9,*/*;q=0.5"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount >= MAX_REDIRECTS) throw new Error("A página excedeu o limite de redirecionamentos.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirecionamento sem destino.");
      return fetchSafe(new URL(location, url).toString(), redirectCount + 1);
    }
    if (!response.ok) throw new Error(`A página respondeu com HTTP ${response.status}.`);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/pdf")) throw new Error("PDF por link ainda não está disponível nesta primeira versão. Use uma página HTML ou cole o texto.");
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
      throw new Error(`Tipo de conteúdo não suportado: ${contentType || "desconhecido"}.`);
    }
    const body = await readLimitedBody(response);
    return { finalUrl: url.toString(), contentType, body };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Tempo limite excedido ao acessar a página.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(value = "") {
  const map = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ndash: "–", mdash: "—", hellip: "…", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’"
  };
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => map[name.toLowerCase()] ?? match);
}

function stripTags(html = "") {
  return decodeEntities(String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<\/div\s*>/gi, "\n")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<\/h[1-6]\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractPageTitle(html = "") {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const title = og?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return stripTags(title).slice(0, 220);
}

function pickMainHtml(html = "") {
  const cleaned = String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|canvas|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const candidates = [
    ...cleaned.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi),
    ...cleaned.matchAll(/<main[^>]*>([\s\S]*?)<\/main>/gi),
    ...cleaned.matchAll(/<div[^>]+(?:class|id)=["'][^"']*(?:entry-content|post-content|article-content|conteudo|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)
  ].map((match) => match[1]);
  if (!candidates.length) return cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || cleaned;
  return candidates.sort((a, b) => stripTags(b).length - stripTags(a).length)[0];
}

function cleanExtractedText(text = "") {
  const lines = String(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const forbidden = [
    /^menu$/i, /^in[ií]cio$/i, /^home$/i, /^compartilhe/i, /^coment[aá]rios?$/i,
    /^aceitar cookies/i, /^pol[ií]tica de privacidade/i, /^todos os direitos reservados/i
  ];
  const out = [];
  let previous = "";
  for (const line of lines) {
    if (forbidden.some((regex) => regex.test(line))) continue;
    const normalized = line.toLowerCase().replace(/\s+/g, " ");
    if (normalized === previous) continue;
    previous = normalized;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function detectLesson(text = "", pageTitle = "") {
  const source = `${pageTitle}\n${text}`;
  const match = source.match(/li[cç][aã]o\s*0*(\d+)\s*[:\-—•]?\s*([^\n]{3,180})/i);
  return {
    number: match ? Number(match[1]) : null,
    title: match ? String(match[2]).trim().replace(/[|–—-]\s*EBD.*$/i, "").slice(0, 180) : pageTitle || ""
  };
}

async function importUrl(url) {
  const fetched = await fetchSafe(url);
  const pageTitle = fetched.contentType.includes("text/plain") ? "" : extractPageTitle(fetched.body);
  const mainHtml = fetched.contentType.includes("text/plain") ? fetched.body : pickMainHtml(fetched.body);
  const cleanedText = cleanExtractedText(fetched.contentType.includes("text/plain") ? mainHtml : stripTags(mainHtml));
  if (cleanedText.length < 200) throw new Error("O conteúdo principal encontrado é muito curto. Cole o texto manualmente.");
  return {
    finalUrl: fetched.finalUrl,
    pageTitle,
    cleanedText,
    detected: detectLesson(cleanedText, pageTitle),
    importedAt: new Date().toISOString()
  };
}

module.exports = {
  importUrl,
  assertSafeUrl,
  cleanExtractedText,
  detectLesson
};
