import * as monacoType from "monaco-editor";

// 变量和函数类型定义
interface Variable {
  name: string;
  type: string;
  isConst: boolean;
  line: number;
  column: number;
  initialized: boolean;
  isArray: boolean;
  arraySize?: number;
  scope?: number;  // 添加作用域深度信息
  isDeclared?: boolean;  // 添加是否已声明标记
}

interface Function {
  name: string;
  returnType: string;
  parameters: { name: string; type: string }[];
  line: number;
  column: number;
}

interface Struct {
  name: string;
  members: { name: string; type: string }[];
  line: number;
  column: number;
}

interface Scope {
  variables: Variable[];
  functions: Function[];
  structs: Struct[];
  parent?: Scope;
}

// SysY+关键字集合
const KEYWORDS = new Set([
  "int", "float", "char", "void", "const", "struct",
  "if", "else", "while", "for", "break", "continue", "return",
  "true", "false", "null"
]);

// 检查是否为关键字
function isKeyword(word: string): boolean {
  return KEYWORDS.has(word);
}

// 检查是否为有效的标识符
function isValidIdentifier(word: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word) && !isKeyword(word);
}

// 检查是否包含非ASCII字符
function hasNonASCII(text: string): boolean {
  return /[^\x00-\x7F]/.test(text);
}

// 查找作用域链中的符号
function findSymbolInScopeChain(scope: Scope, name: string): Variable | Function | Struct | undefined {
  let current: Scope | undefined = scope;
  let maxScope = -1;
  let result: Variable | Function | Struct | undefined;

  while (current) {
    // 查找变量，优先选择最近作用域的变量
    const foundVar = current.variables.find(v => v.name === name);
    if (foundVar && (!result || (foundVar.scope && foundVar.scope > maxScope))) {
      result = foundVar;
      maxScope = foundVar.scope || 0;
    }

    // 查找函数
    const foundFunc = current.functions.find(f => f.name === name);
    if (foundFunc) return foundFunc;

    // 查找结构体类型（只有在全局作用域中查找）
    if (!current.parent) { // 只有在全局作用域查找struct类型名
      const foundStruct = current.structs.find(s => s.name === name);
      if (foundStruct) return foundStruct;
    }

    // 查找函数参数
    // 注意：函数参数已经在其函数作用域中作为变量被添加到 current.variables 中，所以这里理论上不需要再单独查找了
    // 但为了严谨性，可以再检查一次，避免遗漏，但通常情况下会先匹配到 variables
    for (const func of current.functions) {
      const foundParam = func.parameters.find(p => p.name === name);
      if (foundParam) return foundParam;
    }

    current = current.parent;
  }
  return result;
}

// 解析代码并构建符号表
export function parseCode(code: string): { scope: Scope; errors: monacoType.editor.IMarkerData[] } {
  const lines = code.split('\n');
  const globalScope: Scope = { variables: [], functions: [], structs: [] };
  let currentScope: Scope = globalScope; // 当前作用域
  const scopeStack: Scope[] = [globalScope]; // 作用域栈
  const errors: monacoType.editor.IMarkerData[] = [];

  let inBlockComment = false;
  let inStructDefinition = false; // 新增：是否在结构体定义内部
  let currentStructContext: Struct | null = null; // 新增：当前正在定义的结构体上下文
  let braceStack: { line: number; column: number }[] = [];
  let parenthesesStack: { line: number; column: number }[] = [];
  let squareBracketStack: { line: number; column: number }[] = [];
  // 新增：引号栈
  let quoteStack: { type: string; line: number; column: number }[] = [];

  // 添加作用域深度追踪
  let scopeDepth = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;
    let inString = false;
    let inChar = false;
    let inLineComment = false;

    // 检查中文字符 (此处的检查将被移除，移动到字符遍历中)
    // if (hasNonASCII(line)) {
    //   const match = line.match(/[^\x00-\x7F]/);
    //   if (match) {
    //     const column = line.indexOf(match[0]) + 1;
    //     errors.push({
    //       severity: monacoType.MarkerSeverity.Error,
    //       startLineNumber: lineNumber,
    //       startColumn: column,
    //       endLineNumber: lineNumber,
    //       endColumn: column + match[0].length,
    //       message: `非法字符: '${match[0]}'，SysY+只支持ASCII字符`
    //     });
    //   }
    // }

    // 新增：检查缺少分号的错误
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.endsWith(';') && !trimmedLine.endsWith('{') && !trimmedLine.endsWith('}')) {
      // 检查是否是变量声明
      const varDeclMatch = trimmedLine.match(/^\s*(?:const\s+)?(int|float|char)\s+[a-zA-Z_]\w*(?:\s*\[\s*\d+\s*\])*\s*(?:=\s*[^;]+)?$/);
      if (varDeclMatch) {
        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: line.length,
          endLineNumber: lineNumber,
          endColumn: line.length + 1,
          message: "缺少分号 ';'"
        });
      }

      // 检查是否是结构体成员声明
      if (inStructDefinition) {
        const structMemberMatch = trimmedLine.match(/^\s*(?:const\s+)?(int|float|char)\s+[a-zA-Z_]\w*(?:\s*\[\s*\d+\s*\])*\s*(?:=\s*[^;]+)?$/);
        if (structMemberMatch) {
          errors.push({
            severity: monacoType.MarkerSeverity.Error,
            startLineNumber: lineNumber,
            startColumn: line.length,
            endLineNumber: lineNumber,
            endColumn: line.length + 1,
            message: "结构体成员声明缺少分号 ';'"
          });
        }
      }

      // 检查是否是表达式语句
      const exprMatch = trimmedLine.match(/^\s*[a-zA-Z_]\w*(?:\s*\[\s*[^\]]+\s*\])*\s*(?:[+\-*\/%&|^!~]?=)\s*[^;]+$/);
      if (exprMatch) {
        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: line.length,
          endLineNumber: lineNumber,
          endColumn: line.length + 1,
          message: "表达式语句缺少分号 ';'"
        });
      }
    }

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      // 处理字符串和注释状态
      if (!inLineComment && !inBlockComment) {
        if (char === '"' && !inChar) {
          if (!inString) {
            // 开始新的字符串
            quoteStack.push({ type: 'string', line: lineNumber, column: i + 1 });
          } else {
            // 结束字符串
            quoteStack.pop();
          }
          inString = !inString;
        } else if (char === "'" && !inString) {
          if (!inChar) {
            // 开始新的字符
            quoteStack.push({ type: 'char', line: lineNumber, column: i + 1 });
          } else {
            // 结束字符
            quoteStack.pop();
          }
          inChar = !inChar;
        } else if (char === '/' && nextChar === '/' && !inString && !inChar) {
          inLineComment = true;
          i++; // 跳过下一个字符
        } else if (char === '/' && nextChar === '*' && !inString && !inChar) {
          inBlockComment = true;
          i++; // 跳过下一个字符
        }
      } else if (inBlockComment && char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++; // 跳过下一个字符
      }

      // 检查非ASCII字符，但在字符串、字符或注释中不检查
      if (char.charCodeAt(0) > 127 && !inString && !inChar && !inLineComment && !inBlockComment) {
        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: i + 1,
          endLineNumber: lineNumber,
          endColumn: i + 2,
          message: `非法字符: '${char}'，SysY+只支持ASCII字符`
        });
      }

      // 在字符串、字符或注释中不检查语法
      if (inString || inChar || inLineComment || inBlockComment) {
        continue;
      }

      // 检查括号匹配
      if (char === '{') {
        braceStack.push({ line: lineNumber, column: i + 1 });
        // 如果当前不在结构体定义中，才进入新作用域
        if (!inStructDefinition) {
          const newScope: Scope = { variables: [], functions: [], structs: [], parent: currentScope };
          currentScope = newScope;
          scopeStack.push(currentScope);
        }
      } else if (char === '}') {
        if (braceStack.length === 0) {
          errors.push({
            severity: monacoType.MarkerSeverity.Error,
            startLineNumber: lineNumber,
            startColumn: i + 1,
            endLineNumber: lineNumber,
            endColumn: i + 2,
            message: "多余的右大括号 '}'"
          });
        } else {
          braceStack.pop();
          // 如果当前不在结构体定义中，才退出当前作用域（如果不是全局作用域）
          if (!inStructDefinition && scopeStack.length > 1) {
            scopeStack.pop();
            currentScope = scopeStack[scopeStack.length - 1];
          }
        }
      } else if (char === '(') {
        parenthesesStack.push({ line: lineNumber, column: i + 1 });
      } else if (char === ')') {
        if (parenthesesStack.length === 0) {
          errors.push({
            severity: monacoType.MarkerSeverity.Error,
            startLineNumber: lineNumber,
            startColumn: i + 1,
            endLineNumber: lineNumber,
            endColumn: i + 2,
            message: "多余的右小括号 ')'"
          });
        } else {
          parenthesesStack.pop();
        }
      } else if (char === '[') {
        squareBracketStack.push({ line: lineNumber, column: i + 1 });
      } else if (char === ']') {
        if (squareBracketStack.length === 0) {
          errors.push({
            severity: monacoType.MarkerSeverity.Error,
            startLineNumber: lineNumber,
            startColumn: i + 1,
            endLineNumber: lineNumber,
            endColumn: i + 2,
            message: "多余的右中括号 ']'"
          });
        } else {
          squareBracketStack.pop();
        }
      }
    }

    // 重置行内状态
    if (inLineComment) {
      inLineComment = false;
    }

    // 跳过注释和字符串的行
    let cleanLine = line;
    // 移除行注释
    const lineCommentIndex = cleanLine.indexOf('//');
    if (lineCommentIndex !== -1) {
      cleanLine = cleanLine.substring(0, lineCommentIndex);
    }
    // 简单移除字符串（不处理转义）
    cleanLine = cleanLine.replace(/"[^"]*"/g, '""');
    cleanLine = cleanLine.replace(/'[^']*'/g, "''");

    if (cleanLine.trim() === '') continue;

    // 检查结构体声明
    const structDeclPattern = /\bstruct\s+([a-zA-Z_]\w*)\s*/g;
    let structMatch = structDeclPattern.exec(cleanLine);
    if (structMatch) {
      const structName = structMatch[1];

      // 如果当前不在结构体定义内部，且匹配到 struct 关键字
      if (!inStructDefinition) {
        // 检查结构体是否重复定义 (只在全局作用域检查)
        const existingStruct = globalScope.structs.find(s => s.name === structName);
        if (existingStruct) {
          errors.push({
            severity: monacoType.MarkerSeverity.Error,
            startLineNumber: lineNumber,
            startColumn: cleanLine.indexOf(structName) + 1,
            endLineNumber: lineNumber,
            endColumn: cleanLine.indexOf(structName) + structName.length + 1,
            message: `结构体 '${structName}' 重复定义 (首次定义在第 ${existingStruct.line} 行)`
          });
        } else {
          // 匹配到结构体声明，暂存信息并标记正在处理结构体定义
          inStructDefinition = true; // 标记正在处理结构体定义
          currentStructContext = { // 暂存结构体信息
            name: structName,
            members: [],
            line: lineNumber,
            column: cleanLine.indexOf(structName) + 1
          };
          globalScope.structs.push(currentStructContext); // 将结构体本身添加到全局作用域
        }
      }
    }

    // 变量声明处理
    const varDeclPattern = /\b(const\s+)?(int|float|char)\s+([a-zA-Z_]\w*)(\[\s*(\d+)\s*\])*\s*(=\s*[^;]+)?\s*;/g;
    let varMatch;
    while ((varMatch = varDeclPattern.exec(cleanLine)) !== null) {
      const isConst = varMatch[1] !== undefined;
      const type = varMatch[2];
      const name = varMatch[3];
      const isArray = varMatch[4] !== undefined;
      const arraySize = varMatch[5] ? parseInt(varMatch[5]) : undefined;
      const hasInitializer = varMatch[6] !== undefined;

      // 检查变量名是否为关键字
      if (isKeyword(name)) {
        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: cleanLine.indexOf(name) + 1,
          endLineNumber: lineNumber,
          endColumn: cleanLine.indexOf(name) + name.length + 1,
          message: `'${name}' 是关键字，不能用作变量名`
        });
        continue;
      }

      // 检查变量名是否有效
      if (!isValidIdentifier(name)) {
        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: cleanLine.indexOf(name) + 1,
          endLineNumber: lineNumber,
          endColumn: cleanLine.indexOf(name) + name.length + 1,
          message: `'${name}' 不是有效的标识符`
        });
        continue;
      }

      // 如果在结构体定义内部，则添加到结构体成员
      if (inStructDefinition && currentStructContext) {
        // 检查结构体成员是否重复定义 WITHIN THE SAME STRUCT
        const existingMember = currentStructContext.members.find(m => m.name === name);
        if (existingMember) {
          errors.push({
            severity: monacoType.MarkerSeverity.Error,
            startLineNumber: lineNumber,
            startColumn: cleanLine.indexOf(name) + 1,
            endLineNumber: lineNumber,
            endColumn: cleanLine.indexOf(name) + name.length + 1,
            message: `结构体成员 '${name}' 重复定义`
          });
          continue;
        }
        // 添加到结构体成员列表
        currentStructContext.members.push({ name, type }); // 只记录名称和类型，SysY+ 结构体成员不能是数组或 const
      } else {
        // 检查变量是否在当前作用域重复定义 (只检查当前作用域的变量)
        const existingVarInCurrentScope = currentScope.variables.find(v => v.name === name);

        // 检查是否与作用域链中的函数名冲突
        const existingFuncInScopeChain = findSymbolInScopeChain(currentScope, name);
        const isFunctionNameConflict = existingFuncInScopeChain && 'parameters' in existingFuncInScopeChain;

        if (existingVarInCurrentScope || isFunctionNameConflict) {
          let message = `变量 '${name}' 重复定义`;
          if (existingVarInCurrentScope) {
            message += ` (首次定义在第 ${existingVarInCurrentScope.line} 行)`;
          } else if (isFunctionNameConflict) {
            message = `标识符 '${name}' 已被用作函数名 (定义在第 ${existingFuncInScopeChain.line} 行)`;
          }

          errors.push({
            severity: monacoType.MarkerSeverity.Error,
            startLineNumber: lineNumber,
            startColumn: cleanLine.indexOf(name) + 1,
            endLineNumber: lineNumber,
            endColumn: cleanLine.indexOf(name) + name.length + 1,
            message: message
          });
          continue;
        }

        // 如果变量未在当前作用域重复定义且不与函数名冲突，则添加到当前作用域
        currentScope.variables.push({
          name,
          type,
          isConst,
          line: lineNumber,
          column: cleanLine.indexOf(name) + 1,
          initialized: hasInitializer,
          isArray,
          arraySize,
          scope: scopeDepth,
          isDeclared: true
        });
      }
    }

    // 检查函数声明
    const funcDeclPattern = /\b(int|float|char|void)\s+([a-zA-Z_]\w*)\s*\(\s*([^)]*)\s*\)\s*\{?/g;
    let funcMatch;
    while ((funcMatch = funcDeclPattern.exec(cleanLine)) !== null) {
      const returnType = funcMatch[1];
      const name = funcMatch[2];
      const paramStr = funcMatch[3];

      // 检查函数名是否为关键字
      if (isKeyword(name)) {
        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: cleanLine.indexOf(name) + 1,
          endLineNumber: lineNumber,
          endColumn: cleanLine.indexOf(name) + name.length + 1,
          message: `'${name}' 是关键字，不能用作函数名`
        });
        continue;
      }

      // 检查函数重定义：在当前作用域向上查找
      let funcFoundInScope = false;
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        const scope = scopeStack[i];
        if (scope.functions.some(f => f.name === name)) {
          funcFoundInScope = true;
          errors.push({
            severity: monacoType.MarkerSeverity.Error,
            startLineNumber: lineNumber,
            startColumn: cleanLine.indexOf(name) + 1,
            endLineNumber: lineNumber,
            endColumn: cleanLine.indexOf(name) + name.length + 1,
            message: `函数 '${name}' 重复定义 (已在第 ${scope.functions.find(f => f.name === name)?.line} 行定义)`
          });
          break;
        }
      }
      if (funcFoundInScope) continue;

      // 解析参数
      const parameters: { name: string; type: string }[] = [];
      if (paramStr.trim() !== '') {
        const params = paramStr.split(',');
        for (const param of params) {
          const paramMatch = param.trim().match(/\b(int|float|char)\s+([a-zA-Z_]\w*)/);
          if (paramMatch) {
            parameters.push({ type: paramMatch[1], name: paramMatch[2] });
          }
        }
      }

      globalScope.functions.push({
        name,
        returnType,
        parameters,
        line: lineNumber,
        column: cleanLine.indexOf(name) + 1
      });

      // 将函数参数添加到当前作用域的变量列表，以便后续检查
      parameters.forEach(param => {
        currentScope.variables.push({
          name: param.name,
          type: param.type,
          isConst: false,
          line: lineNumber, // 参数行号设置为函数头行号
          column: cleanLine.indexOf(param.name) + 1, // 参数列号
          initialized: true, // 参数默认已初始化
          isArray: false,
          arraySize: undefined
        });
      });
    }

    // 检查未定义的变量使用
    const identifierPattern = /\b([a-zA-Z_]\w*)(\[(?:[^\[\]]*)\])*\b/g;
    let identMatch;
    while ((identMatch = identifierPattern.exec(cleanLine)) !== null) {
      const name = identMatch[1];
      const hasArrayAccess = identMatch[2] !== undefined;

      // 跳过以下情况：
      if (
        isKeyword(name) || // 关键字
        new RegExp(`\\b(int|float|char|void|struct)\\s+${name}\\b`).test(cleanLine) || // 声明语句
        new RegExp(`\\b${name}\\s*\\(`).test(cleanLine) || // 函数调用
        cleanLine.includes(`struct ${name}`) || // 结构体定义
        name === 'main' // main函数
      ) {
        continue;
      }

      // 查找变量定义，考虑作用域
      const definition = findSymbolInScopeChain(currentScope, name);

      // 检查是否是结构体成员访问
      const isMemberAccess = cleanLine.match(
        new RegExp(`\\b([a-zA-Z_]\\w*)\\.${name}\\b`)
      );

      // 处理数组访问
      if (hasArrayAccess) {
        if (definition && 'isArray' in definition && definition.isArray) {
          continue; // 合法的数组访问
        }
        // 如果是数组声明语句，跳过
        if (cleanLine.match(new RegExp(`\\b(int|float|char)\\s+${name}\\s*\\[`))) {
          continue;
        }
      }

      // 错误处理
      if (!definition && !isMemberAccess) {
        // 检查是否在变量声明之前使用
        const isDeclaredLater = lines.slice(lineIndex + 1).some(line =>
          new RegExp(`\\b(int|float|char)\\s+${name}\\b`).test(line)
        );

        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: identMatch.index + 1,
          endLineNumber: lineNumber,
          endColumn: identMatch.index + name.length + 1,
          message: isDeclaredLater
            ? `变量 '${name}' 在声明前使用`
            : `未定义的标识符 '${name}'`
        });
      }
    }

    // 检查赋值语句
    // 修改正则，允许右侧为空
    const assignmentPattern = /\b([a-zA-Z_]\w*)\s*(?:[+\-*\/%&|^!~]?=)\s*([^;]*);/g;
    let assignMatch;
    while ((assignMatch = assignmentPattern.exec(cleanLine)) !== null) {
      const varName = assignMatch[1];
      const rightExpr = assignMatch[2];
      // 检查赋值右侧是否为空
      if (rightExpr.trim() === "") {
        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: assignMatch.index + 1,
          endLineNumber: lineNumber,
          endColumn: assignMatch.index + assignMatch[0].length,
          message: `赋值语句缺少右侧表达式`
        });
        continue;
      }
      // 查找变量：向上遍历作用域栈查找
      const variable = findSymbolInScopeChain(currentScope, varName);

      if (variable) {
        // 检查const变量赋值
        // 只有当是 Variable 类型时才检查 isConst，因为 Function 参数没有 isConst 属性
        // 新增：如果本行是声明并初始化，不报错
        const isDeclarationInit = new RegExp(`\\b(const\\s+)?(int|float|char)\\s+${varName}\\s*(\\[\\s*\\d+\\s*\\])?\\s*=`).test(cleanLine);

        if ('isConst' in variable && variable.isConst && !isDeclarationInit) {
          errors.push({
            severity: monacoType.MarkerSeverity.Error,
            startLineNumber: lineNumber,
            startColumn: assignMatch.index + 1,
            endLineNumber: lineNumber,
            endColumn: assignMatch.index + assignMatch[0].length,
            message: `不能给常量 '${varName}' 赋值`
          });
        }

        // 标记变量已初始化 (仅对 Variable 类型有效)
        if ('initialized' in variable) {
          (variable as Variable).initialized = true;
        }
      } else {
        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: assignMatch.index + 1,
          endLineNumber: lineNumber,
          endColumn: assignMatch.index + varName.length + 1,
          message: `未定义的标识符 '${varName}'（赋值目标）`
        });
      }
    }

    // 检查数组访问
    const arrayAccessPattern = /\b([a-zA-Z_]\w*)\[\s*(\d+)\s*\]/g;
    let arrayMatch;
    while ((arrayMatch = arrayAccessPattern.exec(cleanLine)) !== null) {
      const varName = arrayMatch[1];
      const index = parseInt(arrayMatch[2]);
      // 跳过数组声明行
      if (
        cleanLine.match(
          new RegExp(`\\b(int|float|char)\\s+${varName}\\s*\\[`)
        )
      ) {
        continue;
      }
      // 查找变量：向上遍历作用域栈查找
      const variable = findSymbolInScopeChain(currentScope, varName);

      if (variable && 'isArray' in variable && variable.isArray && variable.arraySize !== undefined) {
        if (index >= variable.arraySize) {
          errors.push({
            severity: monacoType.MarkerSeverity.Error,
            startLineNumber: lineNumber,
            startColumn: arrayMatch.index + 1,
            endLineNumber: lineNumber,
            endColumn: arrayMatch.index + arrayMatch[0].length + 1,
            message: `数组 '${varName}' 索引 ${index} 超出范围 [0, ${variable.arraySize - 1}]`
          });
        }
      } else if (variable && 'isArray' in variable && !variable.isArray) {
        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: arrayMatch.index + 1,
          endLineNumber: lineNumber,
          endColumn: arrayMatch.index + arrayMatch[0].length + 1,
          message: `变量 '${varName}' 不是数组，不能使用下标访问`
        });
      } else {
        errors.push({
          severity: monacoType.MarkerSeverity.Error,
          startLineNumber: lineNumber,
          startColumn: arrayMatch.index + 1,
          endLineNumber: lineNumber,
          endColumn: arrayMatch.index + arrayMatch[0].length + 1,
          message: `数组 '${varName}' 未定义`
        });
      }
    }

    // 检查死循环
    if (/\bwhile\s*\(\s*1\s*\)/.test(cleanLine) || /\bwhile\s*\(\s*true\s*\)/.test(cleanLine)) {
      if (!/\b(break|return)\b/.test(cleanLine)) {
        errors.push({
          severity: monacoType.MarkerSeverity.Warning,
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: line.length + 1,
          message: "检测到可能的死循环"
        });
      }
    }

    // 检查结构体定义结束
    if (inStructDefinition && cleanLine.includes('}')) {
      inStructDefinition = false;
      currentStructContext = null;
    }

    // 在每行结束时检查未闭合的引号
    if (inString) {
      errors.push({
        severity: monacoType.MarkerSeverity.Error,
        startLineNumber: lineNumber,
        startColumn: line.lastIndexOf('"') + 1,
        endLineNumber: lineNumber,
        endColumn: line.length + 1,
        message: "字符串字面量缺少右引号 '\"'"
      });
    }
    if (inChar) {
      errors.push({
        severity: monacoType.MarkerSeverity.Error,
        startLineNumber: lineNumber,
        startColumn: line.lastIndexOf("'") + 1,
        endLineNumber: lineNumber,
        endColumn: line.length + 1,
        message: "字符字面量缺少右引号 \"'\""
      });
    }
  }

  // 检查未匹配的括号
  for (const brace of braceStack) {
    errors.push({
      severity: monacoType.MarkerSeverity.Error,
      startLineNumber: brace.line,
      startColumn: brace.column,
      endLineNumber: brace.line,
      endColumn: brace.column + 1,
      message: "缺少匹配的右大括号 '}'"
    });
  }

  for (const paren of parenthesesStack) {
    errors.push({
      severity: monacoType.MarkerSeverity.Error,
      startLineNumber: paren.line,
      startColumn: paren.column,
      endLineNumber: paren.line,
      endColumn: paren.column + 1,
      message: "缺少匹配的右小括号 ')'"
    });
  }

  for (const bracket of squareBracketStack) {
    errors.push({
      severity: monacoType.MarkerSeverity.Error,
      startLineNumber: bracket.line,
      startColumn: bracket.column,
      endLineNumber: bracket.line,
      endColumn: bracket.column + 1,
      message: "缺少匹配的右中括号 ']'"
    });
  }

  // 新增：检查未匹配的引号
  for (const quote of quoteStack) {
    errors.push({
      severity: monacoType.MarkerSeverity.Error,
      startLineNumber: quote.line,
      startColumn: quote.column,
      endLineNumber: quote.line,
      endColumn: quote.column + 1,
      message: `缺少匹配的右${quote.type === 'string' ? '双' : '单'}引号`
    });
  }

  return { scope: currentScope, errors };
}

export function registerSysYPlusLanguage(monaco: typeof monacoType) {
  monaco.languages.register({ id: "sysyplus" });

  // 语法高亮
  monaco.languages.setMonarchTokensProvider("sysyplus", {
    keywords: [
      "int", "float", "char", "void", "const", "struct", "if", "else", "while", "for", "break", "continue", "return", "true", "false", "null"
    ],
    operators: [
      "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "&&", "||", "++", "--", "+", "-", "*", "/", "&", "|", "^", "%", "<<", ">>", ">>>", "+=", "-=", "*=", "/=", "&=", "|=", "^=", "%=", "<<=", ">>=", ">>>="
    ],
    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    tokenizer: {
      root: [
        [/[a-zA-Z_]\w*/, {
          cases: {
            "@keywords": "keyword",
            "@default": "identifier"
          }
        }],
        { include: "@whitespace" },
        [/[{}()\[\]]/, "@brackets"],
        [/@symbols/, {
          cases: {
            "@operators": "operator",
            "@default": ""
          }
        }],
        [/\d+\.\d+([eE][\-+]?\d+)?/, "number.float"],
        [/\d+/, "number"],
        [/".*?"/, "string"],
        [/'[^\\']'/, "string"],
        [/\/\/.*$/, "comment"],
        [/\/\*.*\*\//, "comment"]
      ],
      whitespace: [
        [/[ \t\r\n]+/, ""],
        [/\/\*/, "comment", "@comment"],
        [/\/\/.*$/, "comment"],
      ],
      comment: [
        [/[^\/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[\/*]/, "comment"]
      ],
    }
  });

  // 悬停提示
  monaco.languages.registerHoverProvider("sysyplus", {
    provideHover: function (
      model: monacoType.editor.ITextModel,
      position: monacoType.Position
    ) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const code = model.getValue();
      const { scope } = parseCode(code);

      // 检查变量
      const variable = scope.variables.find(v => v.name === word.word);
      if (variable) {
        let typeInfo = `**变量**: \`${variable.name}\`\n\n**类型**: \`${variable.type}\``;
        if (variable.isConst) typeInfo += '\n\n**修饰符**: `const`';
        if (variable.isArray) typeInfo += `\n\n**数组大小**: \`${variable.arraySize}\``;
        typeInfo += `\n\n**定义位置**: 第 ${variable.line} 行`;

        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          ),
          contents: [{ value: typeInfo }]
        };
      }

      // 检查函数
      const func = scope.functions.find(f => f.name === word.word);
      if (func) {
        const params = func.parameters.map(p => `${p.type} ${p.name}`).join(', ');
        const typeInfo = `**函数**: \`${func.name}\`\n\n**返回类型**: \`${func.returnType}\`\n\n**参数**: \`(${params})\`\n\n**定义位置**: 第 ${func.line} 行`;

        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          ),
          contents: [{ value: typeInfo }]
        };
      }

      // 检查函数参数
      for (const func of scope.functions) {
        const param = func.parameters.find(p => p.name === word.word);
        if (param) {
          const typeInfo = `**函数参数**: \`${param.name}\`\n\n**类型**: \`${param.type}\`\n\n**所属函数**: \`${func.name}\`\n\n**定义位置**: 第 ${func.line} 行`;
          return {
            range: new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn
            ),
            contents: [{ value: typeInfo }]
          };
        }
      }

      // 检查关键字
      if (KEYWORDS.has(word.word)) {
        const keywordDescriptions: Record<string, string> = {
          'int': '**整数类型** - 32位有符号整数',
          'float': '**浮点类型** - 32位单精度浮点数',
          'char': '**字符类型** - 8位字符',
          'void': '**空类型** - 表示无返回值或无参数',
          'const': '**常量修饰符** - 声明常量',
          'struct': '**结构体** - 用户定义的复合数据类型',
          'if': '**条件语句** - 条件分支',
          'else': '**否则** - 条件语句的另一分支',
          'while': '**循环语句** - 条件循环',
          'for': '**循环语句** - 计数循环',
          'break': '**跳出语句** - 跳出循环或switch',
          'continue': '**继续语句** - 跳过本次循环',
          'return': '**返回语句** - 函数返回'
        };

        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          ),
          contents: [{ value: keywordDescriptions[word.word] || `**关键字**: \`${word.word}\`` }]
        };
      }

      return null;
    }
  });

  // 智能补全
  monaco.languages.registerCompletionItemProvider("sysyplus", {
    provideCompletionItems: (model, position) => {
      const code = model.getValue();
      const { scope } = parseCode(code);
      const suggestions: any[] = [];

      // 添加关键字补全
      const keywords = [
        'int', 'float', 'char', 'void', 'const', 'struct',
        'if', 'else', 'while', 'for', 'break', 'continue', 'return'
      ];

      keywords.forEach(keyword => {
        suggestions.push({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          detail: 'SysY+ 关键字'
        });
      });

      // 添加变量补全
      scope.variables.forEach(variable => {
        suggestions.push({
          label: variable.name,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: variable.name,
          detail: `${variable.type} ${variable.name}${variable.isConst ? ' (const)' : ''}`,
          documentation: `定义在第 ${variable.line} 行`
        });
      });

      // 添加函数补全
      scope.functions.forEach(func => {
        const params = func.parameters.map(p => `${p.type} ${p.name}`).join(', ');
        suggestions.push({
          label: func.name,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: func.name,
          detail: `${func.returnType} ${func.name}(${params})`,
          documentation: `定义在第 ${func.line} 行`
        });
        // 添加函数参数到补全列表
        func.parameters.forEach(param => {
          suggestions.push({
            label: param.name,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: param.name,
            detail: `${param.type} ${param.name} (参数)`,
            documentation: `函数 '${func.name}' 的参数`
          });
        });
      });

      // 添加代码片段
      suggestions.push({
        label: 'main',
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: 'int main() {\n\t${1:// 代码}\n\treturn 0;\n}',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: '主函数模板'
      });

      return { suggestions };
    }
  });

  // 跳转到定义
  monaco.languages.registerDefinitionProvider('sysyplus', {
    provideDefinition: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return [];

      const code = model.getValue();
      const { scope } = parseCode(code);

      // 查找变量定义
      const variable = scope.variables.find(v => v.name === word.word);
      if (variable) {
        return [{
          range: new monaco.Range(variable.line, variable.column, variable.line, variable.column + word.word.length),
          uri: model.uri
        }];
      }

      // 查找函数定义
      const func = scope.functions.find(f => f.name === word.word);
      if (func) {
        return [{
          range: new monaco.Range(func.line, func.column, func.line, func.column + word.word.length),
          uri: model.uri
        }];
      }

      // 查找参数定义
      for (const func of scope.functions) {
        const param = func.parameters.find(p => p.name === word.word);
        if (param) {
          return [{
            // 这里需要更精确的参数位置，但目前只能大致定位到函数名
            range: new monaco.Range(func.line, func.column, func.line, func.column + word.word.length),
            uri: model.uri
          }];
        }
      }

      return [];
    }
  });

  // 参数提示
  monaco.languages.registerSignatureHelpProvider('sysyplus', {
    signatureHelpTriggerCharacters: ['(', ','],
    provideSignatureHelp: (model, position) => {
      const code = model.getValue();
      const { scope } = parseCode(code);

      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      });

      const match = textUntilPosition.match(/([a-zA-Z_]\w*)\s*\([^)]*$/);
      if (match) {
        const funcName = match[1];
        const func = scope.functions.find(f => f.name === funcName);

        if (func) {
          const params = func.parameters.map(p => `${p.type} ${p.name}`).join(', ');
          return {
            value: {
              signatures: [{
                label: `${func.returnType} ${funcName}(${params})`,
                parameters: func.parameters.map(p => ({
                  label: `${p.type} ${p.name}`
                }))
              }],
              activeSignature: 0,
              activeParameter: 0
            },
            dispose: () => { }
          };
        }
      }

      return null;
    }
  });

  // 快速修复
  monaco.languages.registerCodeActionProvider('sysyplus', {
    provideCodeActions: (model, range, context) => {
      const actions: monacoType.languages.CodeAction[] = [];

      context.markers.forEach(marker => {
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

  // 语法检查
  let timeoutId: number;
  monaco.languages.registerDocumentSemanticTokensProvider('sysyplus', {
    getLegend: () => ({
      tokenTypes: ['variable', 'function', 'parameter'],
      tokenModifiers: ['const', 'static']
    }),
    provideDocumentSemanticTokens: () => null,
    releaseDocumentSemanticTokens: () => { }
  });

  // 实时语法检查
  function validateSyntax(model: monacoType.editor.ITextModel) {
    const code = model.getValue();
    const { errors } = parseCode(code);
    monaco.editor.setModelMarkers(model, 'sysyplus', errors);
  }

  // 监听模型变化
  monaco.editor.onDidCreateModel((model) => {
    if (model.getLanguageId() === 'sysyplus') {
      validateSyntax(model);

      model.onDidChangeContent(() => {
        clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          validateSyntax(model);
        }, 500);
      });
    }
  });

  // 代码格式化
  monaco.languages.registerDocumentFormattingEditProvider('sysyplus', {
    provideDocumentFormattingEdits: (model) => {
      const code = model.getValue();
      const lines = code.split('\n');
      const formattedLines: string[] = [];
      let indentLevel = 0;

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (trimmedLine.endsWith('}')) {
          indentLevel = Math.max(0, indentLevel - 1);
        }

        if (trimmedLine !== '') {
          formattedLines.push('  '.repeat(indentLevel) + trimmedLine);
        } else {
          formattedLines.push('');
        }

        if (trimmedLine.endsWith('{')) {
          indentLevel++;
        }
      }

      const formattedCode = formattedLines.join('\n');

      return [{
        range: model.getFullModelRange(),
        text: formattedCode
      }];
    }
  });
}
