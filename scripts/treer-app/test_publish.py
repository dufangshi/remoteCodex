import base64
import json
from pathlib import Path
import tempfile
import unittest
from publish import prepare, digest, publish


class PublisherTests(unittest.TestCase):
    def test_prepare_preserves_exact_bytes_and_indexes_app(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / 'input.json'
            payload = {'format': 'treer.app.bundle/v1', 'manifest': {
                'schema': 'treer.app/v1', 'id': 'org.remote-codex.console', 'version': '0.6.2',
                'frontend': {'component': 'frontend'}, 'components': [{'placement': 'browser'}]},
                'files': [{'path': 'frontend/index.html', 'data': base64.b64encode(b'hello').decode(), 'sha256': digest(b'hello')}]}
            raw = json.dumps(payload, indent=3).encode()
            bundle.write_bytes(raw)
            version, assets, index = prepare(bundle, root / 'out')
            self.assertEqual(version, '0.6.2')
            self.assertEqual(assets[1].read_bytes(), raw)
            self.assertEqual(index['apps'][0]['sha256'], digest(raw))
            payload['files'][0]['data'] = base64.b64encode(b'corrupt').decode()
            bundle.write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, 'checksum'):
                prepare(bundle, root / 'out')
            payload['manifest']['components'][0]['placement'] = 'host'
            bundle.write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, 'browser'):
                prepare(bundle, root / 'out')

    def test_publish_rejects_moving_target_before_network(self):
        with self.assertRaisesRegex(ValueError, 'full source commit'):
            publish('0.6.2', [], {}, 'main')


if __name__ == '__main__':
    unittest.main()
