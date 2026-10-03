"""Timing markers without dumping every interpreted arithmetic step."""
import re


class PhaseDiagnostics:
    def __init__(self, sources, output):
        self.output, self.markers, self.active = output, {}, {}
        for source, lines in sources.items():
            for i, line in enumerate(lines):
                for function, phase in (('识别抓捕对象名称优先OCR', 'ocr.name'), ('CheckCaptureShiny', 'image.shiny')):
                    if re.search(r'=\s*' + function + r'\(', line):
                        self.markers[source, i + 1] = (phase, 'begin')
                        next_line = next((j for j in range(i + 1, len(lines)) if lines[j].strip()), None)
                        if next_line is not None:
                            self.markers[source, next_line + 1] = (phase, 'end')

    def observe(self, point):
        source, line = point.location.source, point.location.line
        marker = self.markers.get((source, line))
        if marker:
            phase, boundary = marker
            if boundary == 'begin':
                self.active[phase] = point.started_at
                self.output(kind='phase.begin', phase=phase, source=source, line=line)
            elif phase in self.active:
                started = self.active.pop(phase)
                self.output(kind='phase.end', phase=phase, source=source, line=line,
                            elapsedMs=round((point.started_at - started) * 1000, 3))
        if point.duration_ms is not None and point.duration_ms >= 1000:
            self.output(kind='execution.wait', source=source, line=line, action=point.action,
                        durationMs=point.duration_ms)

    def close(self):
        for phase in self.active:
            self.output(kind='phase.interrupted', phase=phase)
