"""Continuous PCM reader, stdlib only. Pass the connected state.audio descriptor.

One cursor per consumer. Check skipped/discontinuity/timestamp_error before using
samples for decisions. An empty poll is None; stopped/changed sources raise.
Audio is interleaved little-endian float32 at the endpoint's native sample rate.
"""
from dataclasses import dataclass
import json
import struct
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, ProxyHandler, build_opener


@dataclass(frozen=True)
class AudioBlock:
    session: str
    sequence: int
    timestamp_ns: int
    received_ns: int
    sample_rate: int
    channels: int
    frames: int
    skipped: int
    discontinuity: bool
    timestamp_error: bool
    silent: bool
    pcm: bytes


class Audio:
    def __init__(self, descriptor: dict):
        if descriptor.get('status') != 'connected' or descriptor.get('format') != 'f32le':
            raise ValueError('Audio source is not connected or has an unsupported format')
        self.source = dict(descriptor)
        self.cursor = 0
        # This endpoint is an authenticated local runtime. Avoid Windows proxy
        # discovery for every 5-10ms packet and never send its token to a proxy.
        self.opener = build_opener(ProxyHandler({}))

    def _request(self, mode, timeout, **extra):
        query = urlencode(dict(session=self.source['session'], after=self.cursor, mode=mode, **extra))
        request = Request(self.source['baseUrl'] + '/audio?' + query,
                          headers={'Authorization': 'Bearer ' + self.source['token']})
        try:
            with self.opener.open(request, timeout=timeout) as response:
                if response.status == 204:
                    return None
                h = response.headers
                limit = 16 * 1024 * 1024 + (65540 if mode == 'batch' else 0)
                pcm = response.read(limit + 1)
                if len(pcm) > limit:
                    raise RuntimeError('Audio response exceeds limit')
        except HTTPError as error:
            with error:
                error.read()
            raise RuntimeError({409: 'Audio source session changed',
                                503: 'Audio source stopped or data is stale',
                                401: 'Audio reader authorization failed'}.get(error.code,
                                'Audio read failed: HTTP ' + str(error.code))) from error
        return h, pcm

    def _validate(self, block, cursor):
        if (block.session != self.source['session'] or block.sequence <= cursor
                or block.sample_rate != self.source['sampleRate']
                or block.channels != self.source['channels']
                or not 0 < block.frames <= block.sample_rate
                or len(block.pcm) != block.frames * block.channels * 4
                or len(block.pcm) > 16 * 1024 * 1024
                or block.skipped != (block.sequence - cursor - 1 if cursor else 0)):
            raise RuntimeError('Invalid audio block or changed format')

    def read(self, *, next_block=True, timeout=2) -> AudioBlock | None:
        response = self._request('next' if next_block else 'latest', timeout)
        if response is None:
            return None
        h, pcm = response
        integer = lambda key: int(h['X-Audio-' + key])
        block = AudioBlock(h['X-Audio-Session'], integer('Sequence'), integer('Timestamp-Ns'),
                           integer('Received-Ns'), integer('Sample-Rate'), integer('Channels'),
                           integer('Frames'), integer('Skipped'), bool(integer('Discontinuity')),
                           bool(integer('Timestamp-Error')), bool(integer('Silent')), pcm)
        if h['X-Audio-Format'] != 'f32le':
            raise RuntimeError('Invalid audio format')
        self._validate(block, self.cursor)
        self.cursor = block.sequence
        return block

    def read_many(self, *, max_blocks=64, timeout=2) -> list[AudioBlock]:
        """Drain a bounded backlog in one request, preserving every packet flag."""
        if type(max_blocks) is not int or not 1 <= max_blocks <= 64:
            raise ValueError('Audio batch size must be 1-64')
        if self.source.get('batchVersion') != 1:
            block = self.read(timeout=timeout)  # Older running native process.
            return [] if block is None else [block]
        response = self._request('batch', timeout, max_blocks=max_blocks)
        if response is None:
            return []
        h, body = response
        try:
            if h['X-Audio-Format'] != 'f32le-batch-v1' or len(body) < 4:
                raise ValueError('Invalid batch format')
            size = struct.unpack_from('<I', body)[0]
            if not 0 < size <= 65536 or len(body) < 4 + size:
                raise ValueError('Invalid batch metadata length')
            metadata = json.loads(body[4:4+size])
            entries = metadata['blocks']
            if metadata['version'] != 1 or not isinstance(entries, list) or not 1 <= len(entries) <= max_blocks:
                raise ValueError('Invalid batch metadata')
            blocks, offset, cursor = [], 4 + size, self.cursor
            for entry in entries:
                integers = ['sequence', 'timestamp_ns', 'received_ns', 'sample_rate', 'channels', 'frames', 'skipped']
                flags = ['discontinuity', 'timestamp_error', 'silent']
                if any(type(entry[key]) is not int for key in integers) or any(type(entry[key]) is not bool for key in flags):
                    raise ValueError('Invalid batch packet fields')
                length = entry['frames'] * entry['channels'] * 4
                if length <= 0 or offset + length > len(body):
                    raise ValueError('Invalid batch PCM length')
                block = AudioBlock(**{key: entry[key] for key in ['session', *integers, *flags]}, pcm=body[offset:offset+length])
                self._validate(block, cursor)
                blocks.append(block)
                offset += length
                cursor = block.sequence
            if offset != len(body):
                raise ValueError('Trailing audio batch bytes')
        except (KeyError, TypeError, ValueError, struct.error) as error:
            raise RuntimeError('Invalid audio batch') from error
        # No partial cursor advance if a later packet is corrupt.
        self.cursor = cursor
        return blocks
