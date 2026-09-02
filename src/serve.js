// Showing the chapter you are writing (869ermwjv).
//
// It serves exactly what `build` writes — the same map — so the page somebody
// looks at and the page they would publish cannot drift apart. Generated files
// come from memory and copied ones are streamed from wherever they live, so
// nothing is written to disk and there is nothing to clean up.
//
// A server of about forty lines rather than a dependency: it answers GET for a
// fixed set of paths that this process generated, and 404s everything else. It
// is not a static file server and must not become one.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.md': 'text/markdown; charset=utf-8',
};

export function contentType(name) {
  const dot = name.lastIndexOf('.');
  return TYPES[name.slice(dot)] ?? 'application/octet-stream';
}

/**
 * Serve a built page.
 *
 * THE REQUEST IS WHAT READS THE FILE, when a producer is given rather than a map
 * (869erpuhk). The first version of this held the map it was handed for the life
 * of the process, so `view` served the notebook as it had been at start-up and a
 * reload — the universal gesture for "show me what I just did" — confirmed the
 * old version. An author doubts their edit before they doubt the tool.
 *
 * Asked per request rather than pushed by a watcher, because that is what makes
 * the guarantee unconditional: there is no window in which the page and the file
 * disagree, and nothing to have missed a change. A watcher (869edp5c8) can only
 * ever save the reader a keystroke on top of this.
 *
 * @param {Map<string, {text: string}|{copy: URL}>|(() => Map)} pages what build
 *   produced, or something that produces it — called once per request
 * @param {{port?: number, host?: string}} [options]
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export async function serve(pages, { port = 8777, host = '127.0.0.1' } = {}) {
  const files = typeof pages === 'function' ? pages : () => pages;
  // ASK WHETHER ANYBODY IS THERE, on both stacks, before binding to one of them.
  //
  // An IPv6 wildcard listener — `python3 -m http.server --bind ::` — does not
  // collide with an IPv4 loopback bind, so EADDRINUSE never fires and the bind
  // succeeds. `localhost` then resolves to ::1 first, and the reader gets the
  // other server's directory listing while this one sits unreachable on
  // 127.0.0.1 with nothing anywhere saying why (869ernmvh). Found by somebody
  // authoring their first chapter, which is exactly where it would be found.
  if (port !== 0 && await occupied(port)) port = 0;
  const server = createServer((request, response) => {
    // Only GET, and only the names this process generated: the path never
    // reaches the filesystem, so there is nothing for a `..` to escape into.
    const name = decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\//, '');
    const site = files();
    // A DIRECTORY IS ITS index.html, now that this serves a whole book rather
    // than one page (869eu5tn7): /bratko/ is the key `bratko/index.html`.
    const entry = site.get(name === '' || name.endsWith('/') ? `${name}index.html` : name);
    if (request.method !== 'GET') {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
      return;
    }
    // REDIRECTED RATHER THAN SERVED, when the slash is missing. Handing back
    // /bratko/index.html at /bratko would leave the browser resolving every
    // `../` one level too high, so the page would load and its stylesheet,
    // runtime and engine would not.
    if (!entry && site.has(`${name}/index.html`)) {
      response.writeHead(301, { location: `/${name}/` }).end();
      return;
    }
    if (!entry) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
      return;
    }
    response.writeHead(200, {
      'content-type': contentType(name.endsWith('/') || name === '' ? 'index.html' : name),
      // A page being written is a page that changes under the reader.
      'cache-control': 'no-store',
    });
    if (entry.text !== undefined) {
      response.end(entry.text);
      return;
    }
    createReadStream(entry.copy).on('error', () => response.end()).pipe(response);
  });

  const listening = await listen(server, port, host);
  return {
    url: `http://${host}:${listening}/`,
    port: listening,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Take the port asked for, or any port at all.
 *
 * A tool that dies because something else is on 8777 is a tool that makes the
 * reader find out what. It says which port it took instead.
 */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code !== 'EADDRINUSE') return reject(error);
      server.listen(0, host, () => resolve(server.address().port));
    });
    server.listen(port, host, () => resolve(server.address().port));
  });
}

/**
 * Hand the URL to whatever the desktop uses.
 *
 * TWO WAYS THIS GOES WRONG, both found by reading it rather than running it:
 *
 * - `start` on Windows is a SHELL BUILTIN, not a program, so spawning it by name
 *   fails every time. It has to be run through cmd, and the empty string is
 *   cmd's title argument — without it, a quoted URL becomes the window title and
 *   nothing opens.
 * - spawn reports a missing program ASYNCHRONOUSLY. A try/catch around it catches
 *   nothing, and an 'error' event with no listener is an uncaught exception —
 *   which took the whole command down, AFTER the server had started, on any
 *   machine without an opener. A listener that does nothing is the fix: the URL
 *   is on screen either way, and a browser that will not open is not a reason to
 *   stop serving.
 */
export function openInBrowser(url, { spawnImpl = spawn, platform = process.platform } = {}) {
  const argv = platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : [platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  const child = spawnImpl(argv[0], argv[1], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref?.();
  return child;
}

/**
 * Is something already answering on this port, on either stack?
 *
 * A connect, not a bind: the question is "will the reader reach somebody else
 * here", and a bind can succeed while the answer is yes.
 */
export async function occupied(port, { hosts = ['127.0.0.1', '::1'], timeout = 300 } = {}) {
  const answers = await Promise.all(hosts.map((host) => reachable(host, port, timeout)));
  return answers.some(Boolean);
}

function reachable(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}
