import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime/python'))
from easycon.native.engine import EasyConScriptEngine
from easycon.native.errors import ScriptCompileError
from easycon.native.image_labels import ImageLabel, ImageLabelError, SearchMethod
import numpy as np


class FrlgCompatibility(unittest.TestCase):
    def test_reverse_loop_updates_declared_global_seen_by_candidate_function(self):
        program = EasyConScriptEngine().compile('''
$frame = -1
FUNC candidate(): INT
    RETURN $frame
ENDFUNC
FOR $frame = 25295 TO 25297
    $observed = candidate()
    PRINT $observed
NEXT
''')
        output = []
        program.run(output=output.append)
        self.assertEqual(''.join(output).splitlines(), ['25295', '25296', '25297'])

    def test_preflight_rejects_bad_template_and_frame_before_input(self):
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)
        invalid = ImageLabel('broken', Path('broken.IL'), SearchMethod(5), 'invalid-base64',
                             (0, 0, 20, 20), (0, 0, 20, 20))
        with self.assertRaises(ImageLabelError):
            invalid.preflight(frame)
        outside = ImageLabel('outside', Path('outside.IL'), SearchMethod.TESSER_DETECT, 'expected',
                             (0, 0, 1280, 720), (1280, 0, 20, 20))
        with self.assertRaises(ImageLabelError):
            outside.preflight(frame)

    def test_ocr_string_and_array_membership(self):
        program = EasyConScriptEngine().compile('''
$text = "Wild PIDGEY appeared"
$names = ["PIDGEY", "RATTATA"]
$a = "PIDGEY" IN $text
$b = "PIDGEY" IN $names
$c = "pidgey" IN $names
$d = "RATTATA" IN $text or "PIDGEY" IN $text
PRINT $a
PRINT $b
PRINT $c
PRINT $d
''')
        messages = []
        program.run(output=messages.append)
        self.assertEqual([value.strip().lower() for value in messages], ['true', 'true', 'false', 'true'])

    def test_invalid_membership_rejected_before_execution(self):
        with self.assertRaises(ScriptCompileError):
            EasyConScriptEngine().compile('$invalid = 1 IN "123"')

    def test_calibration_can_clamp_parameter_without_changing_caller(self):
        program = EasyConScriptEngine().compile('''
FUNC clamp($width: INT): INT
    IF $width > 20
        $width = 20
    ENDIF
    RETURN $width
ENDFUNC
$width = 30
$result = clamp($width)
PRINT $result
PRINT $width
''')
        messages = []
        program.run(output=messages.append)
        self.assertEqual([value.strip() for value in messages], ['20', '30'])


if __name__ == '__main__':
    unittest.main()
