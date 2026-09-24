import type { ReactNode } from 'react';
import { scriptHelpExamples as examples } from '../scriptHelpExamples';

export function ScriptHelp() {
  return <div className="script-help-content">
    <p className="dialog-intro">每行一条语句，缩进便于阅读，代码块靠结束关键字配对。命令、关键字和内置函数不区分大小写，变量和自定义函数名区分大小写。空行和字符串外的 <code>#</code> 注释会被忽略。</p>

    <HelpSection title="编辑与实时预览">
      <p className="help-note">点击行号旁的箭头可折叠或展开 IF、FOR、WHILE、FUNC 代码块，支持嵌套和 ELIF / ELSE 分支；省略标记显示隐藏行数。工具栏支持全部折叠 / 展开，也可用 Ctrl+Shift+[ / ] 操作当前块，Ctrl+Alt+[ / ] 操作全部。折叠只影响显示，保存和运行仍使用完整代码。定位错误、跟随执行会自动展开目标行；手动折叠会暂停执行跟随。</p>
      <p className="help-note">停止输入约 0.35 秒后自动检查当前编辑内容，无需连接手柄或保存。首个错误会标红并显示原因，点击“定位错误”跳转；修正后继续检查后续错误。检查通过仅表示语法与类型通过，视频源、搜图标签、设备连接及运行中的数值问题仍会在运行时检查。</p>
      <p className="help-note">运行时显示文件、行号、当前动作和循环次数，绿色行标记随执行移动。滚轮浏览会暂停跟随，可点“恢复跟随”。运行使用启动时的内容；之后的编辑只影响下次运行。查看其他脚本或执行库函数时，上方仍显示本次运行的源码行。</p>
    </HelpSection>

    <HelpSection title="按键、等待与摇杆">
      <HelpRow code="A" detail="点击 A，默认持续 50 毫秒。" />
      <HelpRow code="A 100" detail="按住 A 100 毫秒后松开；也可以写 press A 作为别名。" />
      <HelpRow code="A DOWN → A UP" detail="分两行按下、释放 A；中间可按其他键形成组合。支持 A/B/X/Y、L/R/ZL/ZR、HOME/PLUS/MINUS/CAPTURE、LCLICK/RCLICK、UP/DOWN/LEFT/RIGHT 及四个斜方向。" />
      <HelpRow code="WAIT 500" detail="等待 500 毫秒；单独写数字（例如 500）也表示等待。WAIT 不带参数时默认为 50 毫秒。" />
      <HelpRow code="LS UP, 200" detail="左摇杆向上 200 毫秒后回中；RS 为右摇杆。持续时间前必须有逗号。省略时长会保持方向，使用 LS RESET 或 RS RESET 回中（RESET 不接受时长）。" />
      <p className="help-note">方向：UP、DOWN、LEFT、RIGHT、UPLEFT、UPRIGHT、DOWNLEFT、DOWNRIGHT。也可用非负整数角度：0° 向右，90° 向上，180° 向左，270° 向下。按键和等待时长可用整数变量或表达式，不能为负。</p>
      <pre className="help-code-block">{examples.input}</pre>
    </HelpSection>

    <HelpSection title="变量、常量与表达式">
      <HelpRow code="$count = 3" detail="变量名以 $ 开头；$$name 也可用作变量名。变量可以重新赋值。" />
      <HelpRow code="_LIMIT = 10" detail="以下划线开头的是常量，只能使用编译期表达式赋值。" />
      <HelpRow code="$items = [1, 2, 3]" detail="数组元素类型必须一致；下标从 0 开始，$items[1:3] 包含 1、不包含 3，可省略切片边界。字符串也支持索引和切片。" />
      <HelpRow code="$next = $count + 1" detail="支持整数、小数、字符串、布尔值 true/false，以及括号、函数调用和数组表达式。" />
      <HelpRow code="@目标" detail="读取脚本目录下 ImgLabel 中对应 .IL 图像标签的匹配结果，需要已连接的视频源。可写 $score = @目标，再用 IF $score >= 90 判断。" />
      <p className="help-note">运算符：<code>+</code> <code>-</code> <code>*</code> <code>/</code> <code>\</code> <code>%</code> <code>&amp;</code> <code>|</code> <code>^</code> <code>&lt;&lt;</code> <code>&gt;&gt;</code>、比较运算 <code>==</code> <code>!=</code> <code>&lt;</code> <code>&lt;=</code> <code>&gt;</code> <code>&gt;=</code>，逻辑运算 <code>and</code> <code>or</code> <code>not</code>。字符串可用 <code>&amp;</code> 拼接。</p>
      <p className="help-note">支持 <code>+= -= *= /= \= %= &amp;= |= ^= &lt;&lt;= &gt;&gt;=</code> 复合赋值、按位取反 <code>~</code>、十六进制 <code>0xFF</code>。字符串可用单引号或双引号，支持 <code>{'\\n \\t \\r \\\\ \\" \\\''}</code> 转义。变量需先赋值，后续赋值保持类型；常量不能修改。函数参数和 FOR 计数变量只读。</p>
      <pre className="help-code-block">{examples.values}</pre>
    </HelpSection>

    <HelpSection title="条件与循环">
      <pre className="help-code-block">{examples.condition}</pre>
      <pre className="help-code-block">{examples.loops}</pre>
      <p className="help-note"><code>FOR n … NEXT</code> 重复 n 次；<code>FOR $i = 起点 TO 终点 STEP 步长</code> 包含终点，默认步长为 1，负步长可倒数，不能为 0。<code>FOR … NEXT</code> 不写次数表示无限循环。<code>WHILE 条件 … END</code> 在条件成立时重复。</p>
      <p className="help-note"><code>BREAK</code> 退出一层循环，<code>BREAK 2</code> 退出两层（不超过当前嵌套深度，最大 3 层）；<code>CONTINUE</code> 进入下一轮。IF / FOR 中新建的变量只在该块内有效；在块内更新外层已有变量会保留更新。</p>
    </HelpSection>

    <HelpSection title="函数、导入与返回值">
      <pre className="help-code-block">{examples.functions}</pre>
      <p className="help-note">函数必须在顶层定义，可在声明前调用；参数默认 INT，返回类型默认 VOID。支持 <code>BOOL</code>、<code>INT</code>、<code>DOUBLE</code>、<code>STRING</code> 和对应数组类型；PTR 是外部接口保留类型。用 <code>RETURN 值</code> 返回结果；非 VOID 函数的所有分支都必须返回值。顶层 RETURN 可提前结束主脚本。</p>
      <p className="help-note">库文件放在当前脚本所在目录的 <code>lib/*.ecs</code>，启动时自动加载；<code>IMPORT "common.ecs"</code> 放在脚本开头声明依赖。库内允许变量、常量、函数和 EXTERN 声明。库函数使用库作用域，主脚本与库的变量互相独立，传值请使用参数。</p>
      <p className="help-note"><code>EXTERN FUNC name($x: INT): INT FROM "module"</code> 声明外部函数，但当前应用没有注册外部函数实现，调用会失败。</p>
    </HelpSection>

    <HelpSection title="内置函数">
      <HelpRow code="PRINT(value)" detail={'写入运行日志；可用 PRINT "HP=" & $hp 拼接文本。'} />
      <HelpRow code="ALERT(value)" detail="输出提示信息。" />
      <HelpRow code="RAND(max) / TIME()" detail="生成 0 到 max-1 的随机整数；TIME 返回脚本已运行的毫秒数。" />
      <HelpRow code="LEN(value) / APPEND(array, value)" detail="读取字符串或数组长度；返回追加元素后的新数组。" />
      <HelpRow code="BEEP(freq, ms)" detail="播放指定频率和时长的提示音。" />
      <HelpRow code="OCR(x, y, w, h, lang)" detail="读取当前视频帧指定区域的文字；lang 支持 zh-Hans、zh-Hant、en、ja，需要已连接视频源。PP-OCRv6 small 会返回置信度过滤后的文本。" />
      <HelpRow code="AMIIBO(index)" detail="语法已保留；当前公共运行时尚未接入 Amiibo 执行能力。" />
    </HelpSection>

    <div className="help-shortcuts"><span><kbd>Ctrl K</kbd> 快速查找</span><span><kbd>Ctrl S</kbd> 保存当前文件</span></div>
  </div>;
}

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="help-section"><h3>{title}</h3>{children}</section>;
}

function HelpRow({ code, detail }: { code: string; detail: string }) {
  return <div className="help-row"><code>{code}</code><span>{detail}</span></div>;
}
