'use strict';
/**
 * 与宿主的唯一通道：bridge 模式把渲染端请求写成协议行走 stdout，再开一个本地端口收宿主应答；
 * 非 bridge（手动 start-desktop / 独立应用）退回 HTTP 直连。
 *
 * 回调地址与待应答表由本模块独占，调用方只问 callbackUrl()、只发 hostRequest()。
 * @module dsh-pet/runtime/electron-helper/main/bridge
 */

const fsPromises = require('node:fs/promises');
const { parseRange } = require('../range.js');

/**
 * 造 bridge 通道。
 *
 * @param deps.isBridge - 是否由宿主以 bridge 模式拉起。
 * @param deps.prefix - 协议行前缀（与宿主 helper-process 的 prefix 一致）。
 * @param deps.origin - 非 bridge 模式下的宿主 HTTP 源。
 * @param deps.token - 独立应用的访问凭据（只进请求头）。
 */
function createBridge({ isBridge, prefix, origin, token }) {
  let bridgeSeq = 0;
  /** id -> {resolve, reject}：一个请求对应宿主的一次回调应答 */
  const bridgePending = new Map();
  let bridgeCallbackUrl = '';

  /** 渲染端请求 → 宿主（请求行带回调 URL）；返回宿主应答（{status, contentType?, body?, file?}），超时抛错 */
  function bridgeRequest(method, url, body) {
    return new Promise((resolve, reject) => {
      const id = ++bridgeSeq;
      bridgePending.set(id, { resolve, reject });
      process.stdout.write(prefix + JSON.stringify({ id, method, url, body, cb: bridgeCallbackUrl }) + '\n');
      // 宿主若长期不应答（进程退出/宿主动作挂起）不无限挂起：45s 兜底（LLM 生成最长 30-60s）
      setTimeout(() => {
        const p = bridgePending.get(id);
        if (!p) return;
        bridgePending.delete(id);
        p.reject(new Error('bridge request timeout'));
      }, 45000).unref?.();
    });
  }

  /** 把宿主回调应答（{id, status, ...}）派发给对应请求 */
  function bridgeResolve(resp) {
    const p = resp && bridgePending.get(resp.id);
    if (!p) return;
    bridgePending.delete(resp.id);
    p.resolve(resp);
  }

  /** 本地回调服务器：宿主把应答 POST 到这里（127.0.0.1 随机端口，绕开 stdin/DSH 闸门） */
  function startBridgeCallback() {
    const http = require('node:http');
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/respond') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('dsh-pet: not found');
        return;
      }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try {
          bridgeResolve(JSON.parse(raw));
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ok');
        } catch {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end('dsh-pet: bad payload');
        }
      });
      req.on('error', () => {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('dsh-pet: bad payload');
      });
    });
    server.on('error', (e) => {
      console.error('[workbuddy-pet-desktop-helper] bridge callback server error:', String(e && e.message ? e.message : e));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      bridgeCallbackUrl = 'http://127.0.0.1:' + (addr && typeof addr === 'object' ? addr.port : 0) + '/respond';
      console.error('[workbuddy-pet-desktop-helper] bridge callback: ' + bridgeCallbackUrl);
    });
    return server;
  }

  /** 处理一个渲染端请求：拼宿主请求行 → 等应答 → 组装 Response（素材读盘） */
  async function handleBridgeRequest(request) {
    const url = new URL(request.url); // dsh-pet-bridge://dsh-pet/dsh-pet-7340/...
    const method = request.method || 'GET';
    let body;
    // PATCH 也带体（待办的部分更新）：漏读会让宿主收到空体，把一次正常修改当成坏 JSON。
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      body = await request.text();
    }
    let resp;
    let direct = null;
    // 先试直连：宿主在同机同端口，直连比「等 stdout 中转」快得多，也不会被管道实现差异卡住。
    // 直连失败（宿主还没起来 / 端口变了）再退回 bridge 管道。
    try {
      direct = await directFetch(method, url.pathname + url.search, body);
    } catch (e) {
      console.error('[workbuddy-pet-desktop-helper] direct host fetch failed, falling back to bridge:', String(e && e.message ? e.message : e));
      dbg('BRIDGE-FALLBACK ' + String(e && e.message ? e.message : e));
    }
    if (direct && direct.status < 500) {
      const headers = { 'access-control-allow-origin': '*' };
      if (direct.contentType) headers['content-type'] = direct.contentType;
      return new Response(direct.body, { status: direct.status || 200, headers });
    }
    resp = await bridgeRequest(method, url.pathname + url.search, body);
    const headers = { 'access-control-allow-origin': '*' }; // 渲染端页面是 file:// 源，scheme 跨源需 CORS
    if (resp.contentType) headers['content-type'] = resp.contentType;
    if (resp.file) {
      // 素材：直接读盘返回（宿主已解析好绝对路径）。视频会中途按 `Range: bytes=N-` 补数据，
      // 回整份会让播放器把整份当后半段拼，解到错位处提前 ended（动作被截断）。
      try {
        const data = await fsPromises.readFile(resp.file);
        const decision = parseRange(request.headers.get('range'), data.length);
        if (decision === 'unsatisfiable') {
          return new Response(null, {
            status: 416,
            headers: { ...headers, 'content-range': `bytes */${data.length}`, 'accept-ranges': 'bytes' },
          });
        }
        if (decision !== null) {
          const slice = data.subarray(decision.start, decision.end + 1);
          return new Response(new Uint8Array(slice), {
            status: 206,
            headers: {
              ...headers,
              'content-length': String(slice.length),
              'content-range': `bytes ${decision.start}-${decision.end}/${data.length}`,
              'accept-ranges': 'bytes',
            },
          });
        }
        return new Response(new Uint8Array(data), {
          status: resp.status || 200,
          headers: { ...headers, 'content-length': String(data.length), 'accept-ranges': 'bytes' },
        });
      } catch (e) {
        console.error('[workbuddy-pet-desktop-helper] bridge file read failed:', resp.file, e);
        return new Response('dsh-pet: asset read failed', { status: 500, headers });
      }
    }
    return new Response(resp.body ?? '', { status: resp.status || 200, headers });
  }

  /**
   * 直连宿主 HTTP —— main 进程的 Node fetch，不受浏览器 CORS 限制。
   *
   * 为什么需要它：bridge 模式把请求写到 stdout，由宿主读这一行再把应答 POST 回本地回调端口。
   * 这条链路依赖宿主「读 helper 的 stdout」这一实现细节；宿主换了实现（换了读 stdout 的方式）
   * 之后，渲染端的每一个请求都会挂到超时，表现为「桌面窗口起来了但没有内容、也不定位」
   * （窗口停在 0,0 就是「没拿到 config」的特征）。
   *
   * 直连用的是同一个 ORIGIN（宿主自己的 web server 地址），只是不经 stdout 中转，
   * 因此对宿主是透明的普通 HTTP 请求 —— 宿主侧的路由、认证、素材读盘逻辑全都照旧。
   */
  /** 诊断日志：写到 <DSH_HOME>/dsh-pet/helper-debug.log（DSH 不落 helper 的 stderr，只能自己写） */
  function dbg(msg) {
    try {
      const fs = require('node:fs');
      const path = require('node:path');
      const home = process.env.DSH_HOME || (process.env.USERPROFILE || process.env.HOME || '.') + '/.dsh';
      const dir = path.join(home, 'dsh-pet');
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      fs.appendFileSync(path.join(dir, 'helper-debug.log'), new Date().toISOString() + ' ' + msg + '\n');
    } catch {}
  }

  async function directFetch(method, url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    timer.unref?.();
    try {
      const r = await fetch(origin + url, {
        method,
        signal: controller.signal,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { 'X-DSH-Pet-Token': token } : {}),
        },
        body,
      });
      const buf = Buffer.from(await r.arrayBuffer());
      dbg('DIRECT ' + method + ' ' + url + ' -> ' + r.status + ' len=' + buf.length);
      return {
        status: r.status,
        contentType: r.headers.get('content-type') || undefined,
        body: buf,
      };
    } catch (e) {
      dbg('DIRECT-FAIL ' + method + ' ' + url + ' origin=' + origin + ' err=' + String(e && e.message ? e.message : e));
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 与宿主 handlePetRoute 通信：bridge 模式走管道，手动 start-desktop 流退回 HTTP 直连 */
  async function hostRequest(method, url, body) {
    if (isBridge) return bridgeRequest(method, url, body);
    const resp = await fetch(origin + url, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'X-DSH-Pet-Token': token } : {}),
      },
      body,
    });
    return { status: resp.status, body: await resp.text() };
  }

  return {
    hostRequest,
    handle: handleBridgeRequest,
    startCallback: startBridgeCallback,
    callbackUrl: () => bridgeCallbackUrl,
  };
}

module.exports = { createBridge };
