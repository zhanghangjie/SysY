import Editor from "@monaco-editor/react";
import { useRef, useState } from "react";
import { registerSysYPlusLanguage } from "./sysyplus";
import type * as monacoType from "monaco-editor";
import React from "react";
import { JsonView } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import * as Y from 'yjs';
// @ts-expect-error: y-websocket 没有类型声明，忽略类型检查
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { parseCode } from './sysyplus'; // 导入 parseCode

type ScopeVar = {
  type: string;
  isConst: boolean;
  initialized: boolean;
  length?: number;
  line: number;  // 添加声明行号
  usages: number[];  // 添加使用位置数组
};

// 添加一个新的接口来跟踪结构体成员
interface StructMember {
  name: string;
  type: string;
  structName: string;
}

function App() {
  const monacoRef = useRef<typeof monacoType | null>(null);
  const editorRef = useRef<any>(null);
  const [output, setOutput] = useState<string>("");
  const [ast, setAst] = useState<any>(null);
  const [mode, setMode] = useState<'code' | 'rich'>('code');
  const [richValue, setRichValue] = useState<string>('');

  function handleEditorWillMount(monaco: typeof monacoType) {
    registerSysYPlusLanguage(monaco);
    monacoRef.current = monaco;

    // 支持同名变量多作用域悬停显示，并展示作用域深度和所在函数
    monaco.languages.registerHoverProvider("sysyplus", {
      provideHover: function (model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const code = model.getValue();
        const lines = code.split("\n");
        // 记录每个变量的作用域深度和所在函数
        const foundVars: { type: string; name: string; line: number; scope: number; func: string }[] = [];
        // 新增：记录函数声明
        const foundFuncs: { returnType: string; name: string; params: string; line: number }[] = [];

        let scopeDepth = 0;
        let currentFunc = "全局";
        let inStructScope = false;
        let currentStructName = "";

        const structMembers: StructMember[] = [];

        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];

          // 检查是否为函数声明（优先于变量）
          const funcMatch = line.match(/\b(int|float|char|void)\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)/);
          if (funcMatch && funcMatch[2] === word.word) {
            foundFuncs.push({
              returnType: funcMatch[1],
              name: funcMatch[2],
              params: funcMatch[3],
              line: idx + 1
            });
            // 跳过本行变量名检测，防止函数名被当变量
            continue;
          }

          // 检查是否进入结构体定义
          const structMatch = line.match(/\bstruct\s+([a-zA-Z_]\w*)\s*\{/);
          if (structMatch) {
            inStructScope = true;
            currentStructName = structMatch[1];
            structMembers.length = 0;
            continue;
          }

          if (inStructScope && line.includes('}')) {
            inStructScope = false;
            currentStructName = "";
            structMembers.length = 0;
            continue;
          }

          if (inStructScope) {
            const memberMatch = line.match(/\b(?:const\s+)?(int|float|char)\s+([a-zA-Z_]\w*)/);
            if (memberMatch) {
              structMembers.push({
                name: memberMatch[2],
                type: memberMatch[1],
                structName: currentStructName
              });
              if (memberMatch[2] === word.word) {
                foundVars.push({
                  type: memberMatch[1],
                  name: memberMatch[2],
                  line: idx + 1,
                  scope: -1,
                  func: `结构体${currentStructName}的成员`
                });
              }
            }
            continue;
          }

          // 统计作用域深度
          const openBraces = (line.match(/{/g) || []).length;
          const closeBraces = (line.match(/}/g) || []).length;

          if (!inStructScope) {
            // 检查是否为函数参数
            const paramMatch = line.match(/\b(int|float|char)\s+([a-zA-Z_]\w*)\s*(?=[,)])/);
            if (paramMatch && paramMatch[2] === word.word) {
              // 寻找这个参数所属的函数名
              const functionLine = lines[idx];
              const funcNameMatch = functionLine.match(/\b(int|float|char|void)\s+([a-zA-Z_]\w*)\s*\([^)]*\)/);
              const funcName = funcNameMatch ? funcNameMatch[2] : "unknown";

              foundVars.push({
                type: paramMatch[1],
                name: paramMatch[2],
                line: idx + 1,
                scope: scopeDepth,
                func: `${funcName}函数的参数`  // 修改这里，显示为xx函数的参数
              });
            }

            // 检查变量声明（包括数组）
            const varMatch = line.match(/\b(?:const\s+)?(int|float|char|struct\s+[a-zA-Z_]\w*)\s+([a-zA-Z_]\w*)(\s*(?:\[\s*\d+\s*\])+)?/);
            // 跳过函数名和已处理的函数参数
            if (varMatch && varMatch[2] === word.word && !funcMatch && !paramMatch) {
              let type = varMatch[1];
              // 如果有数组维度信息
              if (varMatch[3]) {
                const dimensions = varMatch[3].match(/\[\s*(\d+)\s*\]/g);
                if (dimensions) {
                  // 提取每个维度的大小
                  const sizes = dimensions.map(d => parseInt(d.match(/\d+/)[0]));
                  type += `[${sizes.join('][')}]`;

                  // 保存数组维度信息
                  const arrayInfo = {
                    dimensions: sizes.length,
                    sizes: sizes
                  };

                  foundVars.push({
                    type,
                    name: varMatch[2],
                    line: idx + 1,
                    scope: scopeDepth,
                    func: currentFunc,
                    arrayInfo // 添加数组信息
                  });
                }
              } else {
                foundVars.push({
                  type,
                  name: varMatch[2],
                  line: idx + 1,
                  scope: scopeDepth,
                  func: currentFunc
                });
              }
            }
          }

          scopeDepth += openBraces - closeBraces;
          if (scopeDepth < 0) scopeDepth = 0;

          // 检查是否离开函数体
          if (closeBraces > 0 && scopeDepth === 0 && !inStructScope) {
            currentFunc = "全局";
          }
        }

        // 优先显示函数信息
        if (foundFuncs.length > 0) {
          const f = foundFuncs[0];
          return {
            range: new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn
            ),
            contents: [
              {
                value:
                  `**函数名**: \`${f.name}\`\n\n` +
                  `- **返回类型**: \`${f.returnType}\`\n` +
                  `- **参数**: \`${f.params || '无'}\`\n` +
                  `- **定义位置**: 第 ${f.line} 行`
              }
            ]
          };
        }

        if (foundVars.length > 0) {
          return {
            range: new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn
            ),
            contents: [
              {
                value: `**变量名**: \`${word.word}\`\n\n` +
                  foundVars.map(v => {
                    if (v.scope === -1) {
                      return `- **类型**: \`${v.type}\`，**定义位置**: 第 ${v.line} 行，**作用域**: ${v.func}`;
                    } else {
                      return `- **类型**: \`${v.type}\`，**定义位置**: 第 ${v.line} 行，**作用域**: ${v.scope === -1 ? v.func :
                        v.func.includes('函数的参数') ? v.func :
                          `${v.scope === 0 ? '全局' : `局部(深度${v.scope})`}，**所在**: ${v.func}`
                        }`;
                    }
                  }).join('\n')
              }
            ]
          };
        }
        return null;
      }
    });

    // 修改快速修复提供器
    monaco.languages.registerCodeActionProvider('sysyplus', {
      provideCodeActions: (model, range, context) => {
        const actions: monacoType.languages.CodeAction[] = [];

        context.markers.forEach(marker => {
          // 处理未定义标识符的情况
          if (marker.message.includes('未定义的标识符')) {
            const match = marker.message.match(/'([^']+)'/);
            if (match) {
              const varName = match[1];
              actions.push({
                title: `声明变量 'int ${varName}'`,
                kind: 'quickfix',
                edit: {
                  edits: [{
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: {
                      range: new monaco.Range(marker.startLineNumber, 1, marker.startLineNumber, 1),
                      text: `int ${varName};\n`
                    }
                  }]
                }
              });
            }
          }

          // 新增：处理缺少分号的情况
          if (marker.message.includes('缺少分号')) {
            actions.push({
              title: "添加分号 ';'",
              kind: 'quickfix',
              edit: {
                edits: [{
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: new monaco.Range(
                      marker.startLineNumber,
                      marker.startColumn,
                      marker.endLineNumber,
                      marker.endColumn
                    ),
                    text: ";"
                  }
                }]
              }
            });
          }

          // 处理关键字的情况
          if (marker.message.includes('是关键字')) {
            const match = marker.message.match(/'([^']+)'/);
            if (match) {
              const varName = match[1];
              actions.push({
                title: `重命名为 '${varName}_var'`,
                kind: 'quickfix',
                edit: {
                  edits: [{
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: {
                      range: new monaco.Range(marker.startLineNumber, marker.startColumn, marker.endLineNumber, marker.endColumn),
                      text: `${varName}_var`
                    }
                  }]
                }
              });
            }
          }
        });

        return {
          actions,
          dispose: () => { }
        };
      }
    });

    monaco.languages.registerCompletionItemProvider('sysyplus', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions = [
          // ...现有的其他补全项...

          // 添加 for 循环模板
          {
            label: 'for',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: [
              'for (int ${1:i} = ${2:0}; ${1:i} < ${3:n}; ${1:i}++) {',
              '\t${0}',
              '}'
            ].join('\n'),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'For 循环模板',
            detail: 'For 循环基本结构',
            range: range
          },

          // 添加带步长的 for 循环模板
          {
            label: 'forStep',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: [
              'for (int ${1:i} = ${2:0}; ${1:i} < ${3:n}; ${1:i} += ${4:step}) {',
              '\t${0}',
              '}'
            ].join('\n'),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'For 循环模板（带步长）',
            detail: 'For 循环带步长的基本结构',
            range: range
          },

          // 添加倒序 for 循环模板
          {
            label: 'forReverse',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: [
              'for (int ${1:i} = ${2:n} - 1; ${1:i} >= 0; ${1:i}--) {',
              '\t${0}',
              '}'
            ].join('\n'),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'For 循环模板（倒序）',
            detail: 'For 循环倒序遍历的基本结构',
            range: range
          },

          // 添加结构体定义模板
          {
            label: 'struct',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: [
              'struct ${1:StructName} {',
              '\tint ${2:member1};',
              '\tchar ${3:member2};',
              '\tfloat ${4:member3};',
              '\t${0}',
              '};'
            ].join('\n'),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: '结构体定义模板',
            detail: '结构体基本结构',
            range: range
          },

          // 添加带数组成员的结构体模板
          {
            label: 'structArray',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: [
              'struct ${1:StructName} {',
              '\tint ${2:arr}[${3:10}];',
              '\tchar ${4:name}[${5:20}];',
              '\tfloat ${6:data}[${7:5}];',
              '\t${0}',
              '};'
            ].join('\n'),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: '带数组成员的结构体定义模板',
            detail: '包含数组成员的结构体结构',
            range: range
          },

          // 添加嵌套结构体定义模板
          {
            label: 'structNested',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: [
              'struct ${1:OuterStruct} {',
              '\tstruct {',
              '\t\tint ${2:x};',
              '\t\tint ${3:y};',
              '\t} ${4:inner};',
              '\t${0}',
              '};'
            ].join('\n'),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: '嵌套结构体定义模板',
            detail: '包含嵌套结构体的结构',
            range: range
          }
        ];

        return { suggestions };
      }
    });
  }

  function handleEditorDidMount(editor: any, monaco: typeof monacoType) {
    editorRef.current = editor;

    // 协同编辑初始化
    const ydoc = new Y.Doc();
    // 'sysyplus-room' 可自定义为你的文档唯一标识
    const provider = new WebsocketProvider('ws://localhost:1234', 'sysyplus-room', ydoc);
    const yText = ydoc.getText('monaco');
    // 绑定 Monaco 和 Yjs
    const monacoBinding = new MonacoBinding(
      yText,
      editorRef.current.getModel(),
      new Set([editorRef.current]),
      provider.awareness
    );
  }

  // 简单语法检查：变量名不能用关键字
  function handleEditorChange(value: string | undefined) {
    if (!monacoRef.current || !editorRef.current) return;
    const model = editorRef.current.getModel();

    if (value) {
      const { errors } = parseCode(value);
      const arrayErrors = checkArrayAccess(value, model);

      // 新增：检测每行缺少引号
      const lines = value.split('\n');
      lines.forEach((line, idx) => {
        let inString = false;
        let inChar = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"' && !inChar) {
            inString = !inString;
          } else if (char === "'" && !inString) {
            inChar = !inChar;
          }
        }
        if (inString) {
          errors.push({
            severity: monacoRef.current.MarkerSeverity.Error,
            startLineNumber: idx + 1,
            startColumn: line.lastIndexOf('"') + 1 || 1,
            endLineNumber: idx + 1,
            endColumn: line.length + 1,
            message: "字符串字面量缺少右引号 '\"'"
          });
        }
        if (inChar) {
          errors.push({
            severity: monacoRef.current.MarkerSeverity.Error,
            startLineNumber: idx + 1,
            startColumn: line.lastIndexOf("'") + 1 || 1,
            endLineNumber: idx + 1,
            endColumn: line.length + 1,
            message: "字符字面量缺少右引号 \"'\""
          });
        }
      });

      // 合并所有错误
      monacoRef.current.editor.setModelMarkers(
        model,
        "owner",
        [...errors, ...arrayErrors]
      );
    } else {
      monacoRef.current.editor.setModelMarkers(model, "owner", []);
    }
  }

  // 导出代码
  function handleExport() {
    const code = editorRef.current?.getValue() || "";
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "code.syy";
    a.click();
    URL.revokeObjectURL(url);
  }

  // 导入代码
  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      editorRef.current?.setValue(text);
    };
    reader.readAsText(file);
  }

  // 代码格式化函数
  function handleFormat() {
    const code = editorRef.current?.getValue() || "";
    const lines = code.split("\n");
    let indent = 0;
    const formatted: string[] = [];
    lines.forEach((rawLine: string) => {
      let line = rawLine.trim();
      if (line.endsWith("}")) indent--;
      if (indent < 0) indent = 0;
      formatted.push("  ".repeat(indent) + line);
      if (line.endsWith("{")) indent++;
    });
    editorRef.current?.setValue(formatted.join("\n"));
  }

  // 编译并运行代码
  async function handleCompileAndRun() {
    const code = editorRef.current?.getValue() || "";
    const res = await fetch("http://localhost:3001/api/runSysYPlus", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ code })
    });
    if (res.ok) {
      const data = await res.json();
      setOutput(data.output);
    } else {
      setOutput("编译失败，请检查后端服务");
    }
  }

  // 简单 AST 解析函数（可后续替换为更强 parser）
  function parseSysYPlusAST(code: string) {
    const ast: any = { type: 'Program', body: [] };
    // 匹配变量声明
    const varRegex = /^\s*(int|float|char)\s+([a-zA-Z_]\w*)\s*;/gm;
    let match;
    while ((match = varRegex.exec(code))) {
      ast.body.push({ type: 'VariableDeclaration', varType: match[1], name: match[2] });
    }
    // 匹配结构体声明
    const structRegex = /struct\s+([a-zA-Z_]\w*)\s*{([^}]*)}/gm;
    while ((match = structRegex.exec(code))) {
      ast.body.push({
        type: 'StructDeclaration',
        name: match[1],
        members: match[2]
          .split(';')
          .map(m => m.trim())
          .filter(Boolean)
          .map(m => {
            const mm = m.match(/(int|float|char)\s+([a-zA-Z_]\w*)/);
            return mm ? { type: mm[1], name: mm[2] } : null;
          })
          .filter(Boolean)
      });
    }
    // 匹配函数声明
    const funcRegex = /(int|float|char|void)\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*{[^}]*}/gm;
    while ((match = funcRegex.exec(code))) {
      ast.body.push({
        type: 'FunctionDeclaration',
        returnType: match[1],
        name: match[2],
        params: match[3]
          ? match[3].split(',').map(p => p.trim()).filter(Boolean)
          : []
      });
    }
    return ast;
  }

  // AST 可视化按钮
  function handleShowAST() {
    const code = editorRef.current?.getValue() || "";
    const astResult = parseSysYPlusAST(code);
    console.log("AST:", astResult);
    setAst(astResult);
  }

  // Tiptap 富文本编辑器实例
  const tiptap = useEditor({
    extensions: [
      StarterKit,
      Image,
      Table,
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: richValue,
    onUpdate: ({ editor }) => {
      setRichValue(editor.getHTML());
    },
  });

  // 切换编辑模式
  function handleToggleMode() {
    if (mode === 'code') {
      // 代码 -> 富文本
      const code = editorRef.current?.getValue() || '';
      setRichValue(`<pre>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`);
      setMode('rich');
      setTimeout(() => {
        tiptap?.commands.setContent(`<pre>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`);
      }, 0);
    } else {
      // 富文本 -> 代码
      const text = tiptap?.getText() || '';
      editorRef.current?.setValue(text);
      setMode('code');
    }
  }

  return (
    <div>
      <button onClick={handleExport}>导出代码</button>
      <input
        type="file"
        accept=".sy,.c,.txt"
        style={{ display: "inline-block", marginLeft: 8 }}
        onChange={handleImport}
      />
      <button onClick={handleFormat} style={{ marginLeft: 8 }}>格式化代码</button>
      <button onClick={handleCompileAndRun} style={{ marginLeft: 8 }}>编译并运行</button>
      <button onClick={handleShowAST} style={{ marginLeft: 8 }}>AST 可视化</button>
      <button onClick={handleToggleMode} style={{ marginLeft: 8 }}>
        {mode === 'code' ? '切换为富文本编辑' : '切换为源码编辑'}
      </button>
      {mode === 'code' ? (
        <Editor
          height="90vh"
          defaultLanguage="sysyplus"
          defaultValue="// 这里写SysY+代码"
          beforeMount={handleEditorWillMount}
          onMount={handleEditorDidMount}
          onChange={handleEditorChange}
          options={{
            renameOnType: true,
            formatOnType: true,
            formatOnPaste: true
          }}
        />
      ) : (
        <div style={{ background: '#fff', minHeight: '90vh', padding: 16 }}>
          <EditorContent editor={tiptap} />
        </div>
      )}
      <div style={{ marginTop: 20 }}>
        <strong>输出结果：</strong>
        <pre>{output}</pre>
      </div>
      <div style={{ marginTop: 20, background: '#222', color: '#fff', padding: 8 }}>
        <strong>AST 可视化：</strong>
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>
          {ast && ast.body && ast.body.length > 0
            ? 'AST 结构如下：'
            : '未能解析出 AST 节点（请检查代码或扩展解析器）'}
        </div>
        <JsonView data={ast || {}} />
        <pre>{JSON.stringify(ast, null, 2)}</pre>
      </div>
    </div>
  );
}

export default App;
