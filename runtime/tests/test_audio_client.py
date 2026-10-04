import io
import json
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'clients'))
from audio import Audio


class AudioClientTests(unittest.TestCase):
    def source(self, **extra):
        return dict(status='connected', session='one', sampleRate=96000, channels=1,
                    format='f32le', baseUrl='http://127.0.0.1:1', token='test', batchVersion=1, **extra)

    def entry(self, sequence=11, **extra):
        return dict(session='one', sequence=sequence, skipped=0, timestamp_ns=1_000_000_000,
                    received_ns=1_000_000_001, sample_rate=96000, channels=1, frames=960,
                    discontinuity=False, timestamp_error=False, silent=False, **extra)

    def response(self, entries, tail=b''):
        header = json.dumps(dict(version=1, blocks=entries)).encode()
        body = struct.pack('<I', len(header)) + header + b''.join(
            b'\x00' * (entry['frames'] * entry['channels'] * 4) for entry in entries) + tail
        result = io.BytesIO(body)
        result.status, result.headers = 200, {'X-Audio-Format': 'f32le-batch-v1'}
        return result

    def test_batch_preserves_order_pcm_flags_and_independent_cursors(self):
        entries = [self.entry(11), self.entry(12)]
        entries[1].update(discontinuity=True, timestamp_error=True, silent=True)
        readers = [Audio(self.source()), Audio(self.source())]
        for reader in readers:
            reader.cursor = 10
            reader.opener.open = Mock(return_value=self.response(entries))
            blocks = reader.read_many(max_blocks=2)
            self.assertEqual([block.sequence for block in blocks], [11, 12])
            self.assertTrue(blocks[-1].discontinuity and blocks[-1].timestamp_error and blocks[-1].silent)
            self.assertEqual(len(blocks[0].pcm), 960 * 4)
            self.assertEqual(reader.cursor, 12)
            self.assertIn('mode=batch', reader.opener.open.call_args.args[0].full_url)
            self.assertIn('max_blocks=2', reader.opener.open.call_args.args[0].full_url)

    def test_overrun_is_preserved_and_invalid_later_packet_never_advances_cursor(self):
        reader = Audio(self.source()); reader.cursor = 10
        first = self.entry(14); first['skipped'] = 3
        reader.opener.open = Mock(return_value=self.response([first, self.entry(15)]))
        self.assertEqual([block.skipped for block in reader.read_many()], [3, 0])
        for mutation in [{'sequence': 18}, {'session': 'another'}, {'channels': 2}, {'silent': 1}]:
            entries = [self.entry(16), self.entry(17)]
            entries[-1].update(mutation)
            reader.opener.open = Mock(return_value=self.response(entries))
            with self.assertRaises(RuntimeError):
                reader.read_many()
            self.assertEqual(reader.cursor, 15)
        reader.opener.open = Mock(return_value=self.response([self.entry(16)], tail=b'extra'))
        with self.assertRaises(RuntimeError):
            reader.read_many()
        self.assertEqual(reader.cursor, 15)

    def test_old_runtime_falls_back_and_empty_poll_does_not_reset_cursor(self):
        reader = Audio(self.source()); reader.source.pop('batchVersion')
        reader.read = Mock(return_value=None)
        self.assertEqual(reader.read_many(), [])
        reader.read.assert_called_once()
        reader.source['batchVersion'] = 1
        response = io.BytesIO(); response.status = 204
        reader.cursor = 10; reader.opener.open = Mock(return_value=response)
        self.assertEqual(reader.read_many(), [])
        self.assertEqual(reader.cursor, 10)
        for limit in [0, 65, True]:
            with self.assertRaises(ValueError):
                reader.read_many(max_blocks=limit)


if __name__ == '__main__':
    unittest.main()
