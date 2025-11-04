#!/usr/bin/env node
import http from 'node:http';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { program } from 'commander';
import superagent from 'superagent';

program
  .requiredOption('-h, --host <host>', 'server host (required)')
  .requiredOption('-p, --port <port>', 'server port (required)', (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error('Invalid port');
    return n;
  })
  .requiredOption('-c, --cache <dir>', 'cache directory (required)');
program.parse(process.argv);
const { host, port, cache } = program.opts();

const isHttpCode = (s) => /^\d{3}$/.test(s);
const imgPath = (code) => path.join(cache, `${code}.jpg`);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function send(res, status, body = '', headers = {}) {
  res.writeHead(status, headers);
  if (body && (Buffer.isBuffer(body) || typeof body === 'string')) res.end(body);
  else res.end();
}

async function handleGET(res, code) {
  try {
    const data = await fs.readFile(imgPath(code));
    return send(res, 200, data, { 'Content-Type': 'image/jpeg' });
  } catch {}
  try {
    const upstream = await superagent.get(`https://http.cat/${code}`).buffer(true).redirects(5);
    // const upstream = await superagent.get(`https://http.cat/${code}.jpg`).buffer(true).redirects(5);
    const data = upstream.body;
    await fs.writeFile(imgPath(code), data);
    return send(res, 200, data, { 'Content-Type': 'image/jpeg' });
  } catch {
    return send(res, 404, 'Not Found\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}
async function handlePUT(req, res, code) {
  const body = await readBody(req);
  if (!body?.length) return send(res, 400, 'Empty body\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  await fs.writeFile(imgPath(code), body);
  return send(res, 201, 'Created\n', { 'Content-Type': 'text/plain; charset=utf-8' });
}
async function handleDELETE(res, code) {
  try {
    await fs.unlink(imgPath(code));
    return send(res, 200, 'OK\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch {
    return send(res, 404, 'Not Found\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

if (!fsSync.existsSync(cache)) await fs.mkdir(cache, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const code = urlObj.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
    if (!isHttpCode(code)) {
      return send(res, 400, 'Bad Request: path must be /<http-code>\n', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    switch (req.method) {
      case 'GET':    return await handleGET(res, code);
      case 'PUT':    return await handlePUT(req, res, code);
      case 'DELETE': return await handleDELETE(res, code);
      default:
        return send(res, 405, 'Method Not Allowed\n', {
          'Allow': 'GET, PUT, DELETE',
          'Content-Type': 'text/plain; charset=utf-8'
        });
    }
  } catch {
    return send(res, 500, 'Internal Server Error\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port} (cache: ${path.resolve(cache)})`);
});
