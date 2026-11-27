#!/usr/bin/env python3
"""Offline pilot acceptance. Runs the actual shell entry point against loopback TLS."""
import json
import os
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SHA = 'a' * 40
TICKET = 'b' * 48


class PilotVerify(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        state = self.root / 'state'
        state.mkdir()
        (state / 'friend-link').write_text(TICKET)
        shell_env = self.root / 'shell-env'
        shell_env.write_text("""
cd() {
  if [[ "${1:-}" == /home/ubuntu/xiutu-pilot ]]; then builtin cd "$PILOT_TEST_SITE"; else builtin cd "$@"; fi
}
docker() {
  case "$1" in
    compose)
      shift 7
      case "$1" in
        ps) echo "container-${!#}" ;;
        config) cat config.json ;;
        exec) echo invite ;;
        *) return 70 ;;
      esac ;;
    image) echo image-id ;;
    inspect) echo 'true image-id' ;;
    *) return 71 ;;
  esac
}
curl() {
  for argument in "$@"; do
    if [[ $argument == *"$PILOT_TEST_TICKET"* ]]; then echo 'Secret in argv' >> leaked; return 72; fi
  done
  command curl "$@"
}
""")
        cert = self.root / 'cert.pem'
        key = self.root / 'key.pem'
        subprocess.run([
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=public.test', '-addext',
            'subjectAltName=DNS:public.test,DNS:gated.test,DNS:broken.test,IP:192.0.2.5',
            '-keyout', str(key), '-out', str(cert),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.env = {**os.environ, 'BASH_ENV': str(shell_env), 'CURL_CA_BUNDLE': str(cert),
                    'PILOT_TEST_SITE': str(self.root), 'PILOT_TEST_TICKET': TICKET,
                    'HTTPS_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': ''}
        self.seen = []
        seen = self.seen

        class Site(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                host = self.headers['Host'].split(':')[0]
                cookie = self.headers.get('Cookie', '')
                seen.append((host, self.path, cookie))
                if self.path == '/go/' + TICKET:
                    self.send_response(404 if host == 'public.test' else 303)
                    if host != 'broken.test':
                        self.send_header('Set-Cookie', f'pass={host}; Secure; HttpOnly; Path=/')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                status = 200
                payload = {}
                if host != 'public.test' and cookie != 'pass=' + host:
                    status = 403
                elif self.path == '/health':
                    payload = {'ok': True}
                elif self.path == '/v1/public-config':
                    payload = {'registrationMode': 'invite', 'capabilities': {'smsConfigured': True}}
                elif self.path == '/v1/session':
                    payload = {'user': None, 'spaces': []}
                elif self.path == '/v1/projects':
                    status = 401
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(('127.0.0.1', 0), Site)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        self.port = server.server_port
        thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)

    def verify(self, hosts, expected=0):
        origins = ', '.join(f'https://{host}:{self.port}' for host in hosts) + ' \r'
        services = {s: {'image': f'xiutu-pilot-server:{SHA}'} for s in ('api', 'worker')}
        services['api']['environment'] = {'APP_ORIGIN': origins}
        services['web'] = {'image': f'xiutu-pilot-web:{SHA}-icp'}
        (self.root / 'config.json').write_text(json.dumps({'services': services}))
        result = subprocess.run([ROOT / 'follow-main.sh', '--verify', SHA], env=self.env,
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, expected, (result.stdout, result.stderr))
        self.assertNotIn(TICKET, result.stdout + result.stderr)
        self.assertFalse((self.root / 'leaked').exists())
        self.assertFalse(list((self.root / 'state').glob('cookies.*')))

    def test_public_domain_before_gated_ip(self):
        self.verify(['192.0.2.5', 'public.test'])
        self.assertEqual([host for host, _, _ in self.seen], ['public.test'] * 5)
        self.assertFalse(any(path.startswith('/go/') for _, path, _ in self.seen))

    def test_single_public_origin_without_friend_link(self):
        (self.root / 'state/friend-link').unlink()
        self.verify(['public.test'])
        self.assertEqual(self.seen[-1], ('public.test', '/v1/projects', ''))

    def test_single_gated_domain(self):
        self.verify(['gated.test'])
        self.assertEqual(self.seen[0], ('gated.test', '/', ''))
        self.assertEqual(self.seen[1], ('gated.test', '/go/' + TICKET, ''))
        self.assertTrue(all(cookie == 'pass=gated.test' for _, _, cookie in self.seen[2:]))
        self.assertEqual(self.seen[-1][1], '/v1/projects')

    def test_tls_failure_and_invalid_cookie_fall_back_to_gated_ip(self):
        self.verify(['192.0.2.5', 'untrusted.test', 'broken.test'])
        self.assertEqual(self.seen[-1], ('192.0.2.5', '/v1/projects', 'pass=192.0.2.5'))
        self.assertFalse(any(host == 'untrusted.test' for host, _, _ in self.seen))

    def test_invalid_cookie_fails_closed(self):
        self.verify(['broken.test'], 1)
        self.assertEqual(len(self.seen), 2)

    def test_commit_replays_history_only_after_durable_decision(self):
        script = r"""
source "$1"
target=$(printf '%040d' 1)
old_sha=$(printf '%040d' 2)
mkdir -p backup
backup=backup old_db=old original_oid=11 pending=state/pending
printf 'RELEASE_SHA=%s\n' "$target" > RELEASE
echo 22 > backup/candidate-oid
echo earlier > state/previous-sha
touch "$pending"
oid_for() { if [[ $1 == old ]]; then echo 11; else echo 22; fi; }
gate_volume() { [[ $1 == release ]]; }
if complete_commit 2>/dev/null; then exit 1; fi
[[ $(cat state/previous-sha) == earlier && -f $pending ]]
echo "$target" > backup/committed
gate_volume() { return 1; }
if complete_commit; then exit 1; fi
[[ $(cat state/previous-sha) == "$old_sha" && -f $pending ]]
gate_volume() { [[ $1 == release ]]; }
complete_commit
[[ $(cat state/previous-sha) == "$old_sha" && ! -f $pending ]]
"""
        subprocess.run(['bash', '-c', script, 'test', ROOT / 'upgrade-schema.sh'],
                       cwd=self.root, check=True)


if __name__ == '__main__':
    unittest.main()
