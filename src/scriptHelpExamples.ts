// Kept executable: the engine tests compile every complete example below.
export const scriptHelpExamples = {
  input: `# 所有时长均为毫秒
A 100
A DOWN
B 50
A UP
WAIT 500
LS UP, 200
RS 45, 100
LS RESET`,
  values: `_LIMIT = 10
$count = 3
$count += 1
$items = [1, 2, 3]
$items[0] = 5
$items = APPEND($items, 4)
$part = $items[1:3]
$length = LEN($items)
$name = "确认"
$enabled = true`,
  condition: `$count = 3
IF $count > 0
  PRINT "还有 " & $count
ELIF $count == 0
  PRINT "完成"
ELSE
  PRINT "无效"
ENDIF`,
  loops: `FOR 3
  A 50
NEXT

FOR $i = 1 TO 5 STEP 1
  PRINT $i
NEXT

$count = 3
WHILE $count > 0
  $count -= 1
END`,
  functions: `FUNC confirm($times: INT): VOID
  FOR $times
    A 50
    WAIT 100
  NEXT
ENDFUNC

FUNC add($a: INT, $b: INT): INT
  RETURN $a + $b
ENDFUNC

CALL confirm(2)
$result = add(1, 2)
PRINT $result`,
};
