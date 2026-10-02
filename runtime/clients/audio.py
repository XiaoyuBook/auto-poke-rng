"""Continuous PCM reader, stdlib only. Pass the connected state.audio descriptor.

One cursor per consumer. Check skipped/discontinuity/timestamp_error before using
samples for decisions. An empty poll is None; stopped/changed sources raise.
Audio is interleaved little-endian float32 at the endpoint's native sample rate.
"""
from dataclasses import dataclass
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


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

    def read(self, *, next_block=True, timeout=2) -> AudioBlock | None:
        query = urlencode(dict(session=self.source['session'], after=self.cursor,
                               mode='next' if next_block else 'latest'))
        request = Request(self.source['baseUrl'] + '/audio?' + query,
                          headers={'Authorization': 'Bearer ' + self.source['token']})
        try:
            with urlopen(request, timeout=timeout) as response:
                if response.status == 204:
                    return None
                h = response.headers
                pcm = response.read(16 * 1024 * 1024 + 1)
        except HTTPError as error:
            with error:
                error.read()
            raise RuntimeError({409: 'Audio source session changed',
                                503: 'Audio source stopped or data is stale',
                                401: 'Audio reader authorization failed'}.get(error.code,
                                'Audio read failed: HTTP ' + str(error.code))) from error
        integer = lambda key: int(h['X-Audio-' + key])
        block = AudioBlock(h['X-Audio-Session'], integer('Sequence'), integer('Timestamp-Ns'),
                           integer('Received-Ns'), integer('Sample-Rate'), integer('Channels'),
                           integer('Frames'), integer('Skipped'), bool(integer('Discontinuity')),
                           bool(integer('Timestamp-Error')), bool(integer('Silent')), pcm)
        if (block.session != self.source['session'] or block.sequence <= self.cursor
                or h['X-Audio-Format'] != 'f32le'
                or block.sample_rate != self.source['sampleRate']
                or block.channels != self.source['channels']
                or not 0 < block.frames <= block.sample_rate
                or len(pcm) != block.frames * block.channels * 4
                or len(pcm) > 16 * 1024 * 1024
                or block.skipped != (block.sequence - self.cursor - 1 if self.cursor else 0)):
            raise RuntimeError('Invalid audio block or changed format')
        self.cursor = block.sequence
        return block
