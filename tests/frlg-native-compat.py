import sys
from pathlib import Path
import unittest

_root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(_root / 'runtime/python'), str(_root / 'runtime/python/frlg_planner')]
from easycon.native.engine import EasyConScriptEngine
from easycon.native.errors import ScriptCancelled, ScriptCompileError
from easycon.native.image_labels import ImageLabel, ImageLabelError, SearchMethod
import numpy as np
import automation.easycon118 as frlg
from frlg_menu_model import StartMenu


class FrlgMenuNavigation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = (_root / 'tests/fixtures/frlg-settings-menu-original.ecs').read_text(encoding='utf-8')
        helper = frlg.SHORTCUT_REGISTRATION_MAIN_PATH.read_text(encoding='utf-8')
        # Route choice is supplied separately; execute the real Bag helper.
        cls.helper = frlg.SHORTCUT_REGISTRATION_MAIN_MARKER + '\n\n' + helper[helper.index('FUNC 检查并校正快捷登记'):]

    def replay(self, text, starter, shortcut):
        pad = StartMenu(starter, shortcut)
        program = EasyConScriptEngine().compile(
            f'$starter = {int(starter)}\n$shortcut = {shortcut}\n' + text)
        program.run(gamepad=pad, waiter=lambda ms, cancel: None,
                    external_getters={name: (lambda name=name: pad.score(name)) for name in program.external_labels})
        return pad.opened

    def test_original_and_fixed_cold_start_open_options(self):
        fixed = frlg._apply_shortcut_registration_main_text(self.original, self.helper)
        for starter in (False, True):
            with self.subTest(starter=starter):
                self.assertEqual(self.replay(self.original, starter, 0), ['OPTION'])
                self.assertEqual(self.replay(fixed, starter, 0), ['OPTION'])

    def test_shortcut_check_returns_from_bag_then_opens_options(self):
        fixed = frlg._apply_shortcut_registration_main_text(self.original, self.helper)
        for starter in (False, True):
            for shortcut in (1, 2, 3):
                with self.subTest(starter=starter, shortcut=shortcut):
                    self.assertEqual(self.replay(fixed, starter, shortcut), ['BAG', 'OPTION'])

    def test_old_clamp_reproduces_save_and_migration_is_idempotent(self):
        legacy = self.original.replace(frlg.SHORTCUT_REGISTRATION_OPTIONS_ORIGINAL,
                                       frlg.SHORTCUT_REGISTRATION_OPTIONS_LEGACY)
        self.assertEqual(self.replay(legacy, False, 0), ['SAVE'])
        fixed = frlg._apply_shortcut_registration_main_text(legacy, self.helper)
        self.assertEqual(self.replay(fixed, False, 0), ['OPTION'])
        self.assertEqual(frlg._apply_shortcut_registration_main_text(fixed, self.helper), fixed)


class FrlgCompatibility(unittest.TestCase):
    def test_python_extern_cancellation_remains_cancellation(self):
        program = EasyConScriptEngine().compile('''
EXTERN FUNC scan(): INT FROM "python:test"
$result = scan()
''')
        def stop():
            raise ScriptCancelled('stopped during Python scan')
        with self.assertRaises(ScriptCancelled):
            program.run(extern_functions={'scan': stop})

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
