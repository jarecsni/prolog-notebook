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
 * @param {Map<string, {text: string}|{copy: URL}>} files what build produced
 * @param {{port?: number, host?: string}} [options]
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export async function serve(files, { port = 8777, host = '127.0.0.1' } = {}) {
  const server = createServer((request, response) => {
    // Only GET, and only the names this process generated: the path never
    // reaches the filesystem, so there is nothing for a `..` to escape into.
    const name = decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\//, '');
    const entry = files.get(name === '' ? 'index.html' : name);
    if (request.method !== 'GET' || !entry) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
      return;
    }
    response.writeHead(200, {
      'content-type': contentType(name || 'index.html'),
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
