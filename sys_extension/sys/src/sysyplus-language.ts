import * as vscode from 'vscode';

// 变量和函数类型定义
interface Variable {
  name: string;
  type: string;
  isConst: boolean;
  line: number;
  column: number;
  initialized: boolean;
  isArray: boolean;
  arraySize?: number | number[]; // 支持多维数组
  scope: string; // 添加作用域标识
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
  scopeId: string; // 添加作用域ID
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

// 解析代码并构建符号表
function parseCode(code: string): { scope: Scope; diagnostics: vscode.Diagnostic[] } {
  const lines = code.split('\n');
  const scope: Scope = { variables: [], functions: [], structs: [], scopeId: 'global' };
  const diagnostics: vscode.Diagnostic[] = [];

  let inBlockComment = false;
  let braceStack: { line: number; column: number }[] = [];
  let parenthesesStack: { line: number; column: number }[] = [];
  let squareBracketStack: { line: number; column: number }[] = [];
  // 定义作用域栈
  let scopeStack: string[] = ['global'];
  let currentScopeId = 'global';
  let scopeCounter = 0;

  // 用于跟踪已声明的变量（包括初始化状态）
  const declaredVariables = new Map<string, { initialized: boolean; line: number; scope: string }>();
  // 用于跟踪变量使用
  const variableUsages = new Map<string, { line: number; column: number }[]>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex];
    const lineNumber = lineIndex + 1;
    let inString = false;
    let inChar = false;
    let inLineComment = false;

    // 检查中文字符（只检查非注释部分）
    let checkLine = line;
    // 移除行注释
    const commentIdx = checkLine.indexOf('//');
    if (commentIdx !== -1) {
      checkLine = checkLine.substring(0, commentIdx);
    }
    // 移除块注释内容
    checkLine = checkLine.replace(/\/\*[\s\S]*?\*\//g, '');

    if (hasNonASCII(checkLine)) {
      const match = checkLine.match(/[^\x00-\x7F]/);
      if (match) {
        const column = line.indexOf(match[0]);
        diagnostics.push({
          severity: vscode.DiagnosticSeverity.Error,
          range: new vscode.Range(lineIndex, column, lineIndex, column + match[0].length),
          message: `非法字符: '${match[0]}'，SysY+只支持ASCII字符`,
          source: 'sysyplus'
        });
      }
    }

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      // 处理字符串和注释状态
      if (!inLineComment && !inBlockComment) {
        if (char === '"' && !inChar) {
          inString = !inString;
        } else if (char === "'" && !inString) {
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

      // 在字符串、字符或注释中不检查语法
      if (inString || inChar || inLineComment || inBlockComment) {
        continue;
      }

      // 检查括号匹配
      if (char === '{') {
        braceStack.push({ line: lineNumber, column: i });
        // 创建新的作用域
        scopeCounter++;
        currentScopeId = `scope_${scopeCounter}`;
        scopeStack.push(currentScopeId);
      } else if (char === '}') {
        if (braceStack.length === 0) {
          diagnostics.push({
            severity: vscode.DiagnosticSeverity.Error,
            range: new vscode.Range(lineIndex, i, lineIndex, i + 1),
            message: "多余的右大括号 '}'",
            source: 'sysyplus'
          });
        } else {
          braceStack.pop();
          scopeStack.pop();
          currentScopeId = scopeStack[scopeStack.length - 1] || 'global';
        }
      } else if (char === '(') {
        parenthesesStack.push({ line: lineNumber, column: i });
      } else if (char === ')') {
        if (parenthesesStack.length === 0) {
          diagnostics.push({
            severity: vscode.DiagnosticSeverity.Error,
            range: new vscode.Range(lineIndex, i, lineIndex, i + 1),
            message: "多余的右小括号 ')'",
            source: 'sysyplus'
          });
        } else {
          parenthesesStack.pop();
        }
      } else if (char === '[') {
        squareBracketStack.push({ line: lineNumber, column: i });
      } else if (char === ']') {
        if (squareBracketStack.length === 0) {
          diagnostics.push({
            severity: vscode.DiagnosticSeverity.Error,
            range: new vscode.Range(lineIndex, i, lineIndex, i + 1),
            message: "多余的右中括号 ']'",
            source: 'sysyplus'
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

    // 检查缺少分号（排除以{、}、:、,、)结尾的行和预处理指令）
    const trimmed = cleanLine.trim();
    if (
      !trimmed.endsWith(';') &&
      !trimmed.endsWith('{') &&
      !trimmed.endsWith('}') &&
      !trimmed.endsWith(':') &&
      !trimmed.endsWith(',') &&
      !trimmed.endsWith(')') &&
      !trimmed.startsWith('#') && // 预处理指令
      // 排除函数声明（如 int main()）
      !/^\b(int|float|char|void)\b\s+[a-zA-Z_]\w*\s*\(.*\)\s*$/.test(trimmed)
    ) {
      // 只对可能需要分号的语句进行检查
      // 例如赋值、变量声明、表达式等
      if (
        /^(int|float|char|const|struct\b.*)\b/.test(trimmed) || // 变量声明
        /^[a-zA-Z_][a-zA-Z0-9_]*\s*=/.test(trimmed) || // 赋值
        /^[a-zA-Z_][a-zA-Z0-9_]*\s*\[.*\]\s*=/.test(trimmed) || // 数组赋值
        /^[a-zA-Z_][a-zA-Z0-9_]*\s*\(.*\)/.test(trimmed) // 函数调用
      ) {
        diagnostics.push({
          severity: vscode.DiagnosticSeverity.Error,
          range: new vscode.Range(lineIndex, 0, lineIndex, line.length),
          message: "缺少分号 ';'",
          source: 'sysyplus'
        });
      }
    }

    // 跳过结构体体内的变量声明
    // 检查本行是否在结构体体内
    let inStructBody = false;
    for (const struct of scope.structs) {
      // 假设结构体定义只占一行（如 struct S { int x; int y; };）
      // 如果有多行结构体定义，需要更复杂的处理
      if (struct.line === lineNumber) {
        inStructBody = true;
        break;
      }
    }

    // 检查变量声明 - 改进的正则表达式，支持二维数组
    if (!inStructBody) {
      const varDeclPattern = /\b(const\s+)?(int|float|char|struct\s+\w+)\s+([a-zA-Z_]\w*)(\[([^\]]*)\])*\s*(=\s*[^;]+)?\s*;/g;
      let varMatch;
      while ((varMatch = varDeclPattern.exec(cleanLine)) !== null) {
        // 检查是否在结构体声明内
        if (isInStructDeclaration(cleanLine)) {
          continue; // 如果是结构体成员，跳过添加到变量列表
        }
        
        // 额外检查：如果这行包含struct关键字且有大括号，也跳过
        if (/\bstruct\s+\w+\s*\{/.test(cleanLine)) {
          continue;
        }

        const isConst = varMatch[1] !== undefined;
        const type = varMatch[2];
        const name = varMatch[3];
        const hasInitializer = varMatch[6] !== undefined;
        
        // 解析多维数组
        let isArray = false;
        let arraySize: number | number[] | undefined = undefined;
        
        // 检测数组维度
        const arrayPattern = /\[([^\]]*)\]/g;
        const arrayMatches = [];
        let arrayMatch;
        const originalName = varMatch[0];
        
        while ((arrayMatch = arrayPattern.exec(originalName)) !== null) {
          const sizeStr = arrayMatch[1].trim();
          if (sizeStr && /^\d+$/.test(sizeStr)) {
            arrayMatches.push(parseInt(sizeStr));
          }
        }
        
        if (arrayMatches.length > 0) {
          isArray = true;
          arraySize = arrayMatches.length === 1 ? arrayMatches[0] : arrayMatches;
        }

        // 检查变量名是否为关键字
        if (isKeyword(name)) {
          const nameIndex = cleanLine.indexOf(name);
          diagnostics.push({
            severity: vscode.DiagnosticSeverity.Error,
            range: new vscode.Range(lineIndex, nameIndex, lineIndex, nameIndex + name.length),
            message: `'${name}' 是关键字，不能用作变量名`,
            source: 'sysyplus'
          });
          continue;
        }

        // 检查变量名是否有效
        if (!isValidIdentifier(name)) {
          const nameIndex = cleanLine.indexOf(name);
          diagnostics.push({
            severity: vscode.DiagnosticSeverity.Error,
            range: new vscode.Range(lineIndex, nameIndex, lineIndex, nameIndex + name.length),
            message: `'${name}' 不是有效的标识符`,
            source: 'sysyplus'
          });
          continue;
        }

        // 检查变量重定义 - 只在同一作用域内检查
        const scopedName = `${currentScopeId}:${name}`;
        const existingVar = scope.variables.find(v => v.name === name && v.scope === currentScopeId);
        if (existingVar) {
          const nameIndex = cleanLine.indexOf(name);
          diagnostics.push({
            severity: vscode.DiagnosticSeverity.Error,
            range: new vscode.Range(lineIndex, nameIndex, lineIndex, nameIndex + name.length),
            message: `变量 '${name}' 在当前作用域重复定义 (首次定义在第 ${existingVar.line} 行)`,
            source: 'sysyplus'
          });
          continue;
        }

        // 检查const变量必须初始化
        if (isConst && !hasInitializer) {
          const nameIndex = cleanLine.indexOf(name);
          diagnostics.push({
            severity: vscode.DiagnosticSeverity.Error,
            range: new vscode.Range(lineIndex, nameIndex, lineIndex, nameIndex + name.length),
            message: `常量 '${name}' 必须初始化`,
            source: 'sysyplus'
          });
        }

        // 记录变量声明
        declaredVariables.set(scopedName, {
          initialized: hasInitializer,
          line: lineNumber,
          scope: currentScopeId
        });

        // 只在确定不是结构体成员时添加到变量列表
        scope.variables.push({
          name,
          type,
          isConst,
          line: lineNumber,
          column: cleanLine.indexOf(name),
          initialized: hasInitializer,
          isArray,
          arraySize,
          scope: currentScopeId
        });
      }
    }

    // 检查函数声明 - 改进的正则表达式
    const funcDeclPattern = /\b(int|float|char|void)\s+([a-zA-Z_]\w*)\s*\(\s*([^)]*)\s*\)\s*\{?/g;
    let funcMatch;
    while ((funcMatch = funcDeclPattern.exec(cleanLine)) !== null) {
      const returnType = funcMatch[1];
      const name = funcMatch[2];
      const paramStr = funcMatch[3];

      // 检查函数名是否为关键字
      if (isKeyword(name)) {
        const nameIndex = cleanLine.indexOf(name);
        diagnostics.push({
          severity: vscode.DiagnosticSeverity.Error,
          range: new vscode.Range(lineIndex, nameIndex, lineIndex, nameIndex + name.length),
          message: `'${name}' 是关键字，不能用作函数名`,
          source: 'sysyplus'
        });
        continue;
      }

      // 检查函数重定义
      const existingFunc = scope.functions.find(f => f.name === name);
      if (existingFunc) {
        const nameIndex = cleanLine.indexOf(name);
        diagnostics.push({
          severity: vscode.DiagnosticSeverity.Error,
          range: new vscode.Range(lineIndex, nameIndex, lineIndex, nameIndex + name.length),
          message: `函数 '${name}' 重复定义 (首次定义在第 ${existingFunc.line} 行)`,
          source: 'sysyplus'
        });
        continue;
      }

      // 解析参数
      const parameters: { name: string; type: string }[] = [];
      if (paramStr.trim() !== '') {
        const params = paramStr.split(',');
        for (const param of params) {
          const paramMatch = param.trim().match(/\b(int|float|char)\s+([a-zA-Z_]\w*)/);
          if (paramMatch) {
            parameters.push({ type: paramMatch[1], name: paramMatch[2] });
            
            // 为函数创建专门的作用域
            const funcScopeId = `scope_func_${name}`;
            const paramScopedName = `${funcScopeId}:${paramMatch[2]}`;
            declaredVariables.set(paramScopedName, {
              initialized: true, // 函数参数默认已初始化
              line: lineNumber,
              scope: funcScopeId
            });
            
            // 将函数参数也添加到变量列表中，使用函数作用域
            scope.variables.push({
              name: paramMatch[2],
              type: paramMatch[1],
              isConst: false,
              line: lineNumber,
              column: param.indexOf(paramMatch[2]),
              initialized: true,
              isArray: false,
              arraySize: undefined,
              scope: funcScopeId
            });
          }
        }
      }

      scope.functions.push({
        name,
        returnType,
        parameters,
        line: lineNumber,
        column: cleanLine.indexOf(name)
      });
    }

    // 添加结构体解析的正则表达式
    const structPattern = /\bstruct\s+([a-zA-Z_]\w*)\s*\{([^}]*)\}/g;
    let structMatch;
    while ((structMatch = structPattern.exec(cleanLine)) !== null) {
      const name = structMatch[1];
      const membersStr = structMatch[2];
      const members: { name: string; type: string }[] = [];

      // 解析结构体成员
      const memberLines = membersStr.split(';').filter(line => line.trim());
      for (const memberLine of memberLines) {
        const memberMatch = memberLine.trim().match(/\b(int|float|char|struct\s+\w+)\s+([a-zA-Z_]\w*)/);
        if (memberMatch) {
          members.push({
            type: memberMatch[1],
            name: memberMatch[2]
          });
        }
      }

      scope.structs.push({
        name,
        members,
        line: lineNumber,
        column: cleanLine.indexOf(name)
      });
    }

    // 检查赋值语句 - 标记变量为已初始化
    const assignmentPattern = /\b([a-zA-Z_]\w*)\s*=\s*([^;]+);/g;
    let assignMatch;
    while ((assignMatch = assignmentPattern.exec(cleanLine)) !== null) {
      const varName = assignMatch[1];

      // 查找变量在当前作用域或父作用域中
      let foundVar = false;
      
      // 首先检查当前作用域栈
      for (const scopeId of scopeStack) {
        const scopedName = `${scopeId}:${varName}`;
        const varInfo = declaredVariables.get(scopedName);
        if (varInfo) {
          const variable = scope.variables.find(v => v.name === varName && v.scope === scopeId);
          if (variable) {
            // 检查const变量赋值
            if (variable.isConst && varInfo.initialized) {
              diagnostics.push({
                severity: vscode.DiagnosticSeverity.Error,
                range: new vscode.Range(lineIndex, assignMatch.index!, lineIndex, assignMatch.index! + assignMatch[0].length),
                message: `不能给常量 '${varName}' 赋值`,
                source: 'sysyplus'
              });
            } else {
              // 标记变量已初始化
              varInfo.initialized = true;
              variable.initialized = true;
            }
            foundVar = true;
            break;
          }
        }
      }
      
      // 如果没找到，检查函数参数
      if (!foundVar) {
        for (const func of scope.functions) {
          if (lineNumber > func.line) {
            const funcScopeId = `scope_func_${func.name}`;
            const scopedName = `${funcScopeId}:${varName}`;
            const varInfo = declaredVariables.get(scopedName);
            if (varInfo) {
              const variable = scope.variables.find(v => v.name === varName && v.scope === funcScopeId);
              if (variable) {
                // 检查const变量赋值
                if (variable.isConst && varInfo.initialized) {
                  diagnostics.push({
                    severity: vscode.DiagnosticSeverity.Error,
                    range: new vscode.Range(lineIndex, assignMatch.index!, lineIndex, assignMatch.index! + assignMatch[0].length),
                    message: `不能给常量 '${varName}' 赋值`,
                    source: 'sysyplus'
                  });
                } else {
                  // 标记变量已初始化
                  varInfo.initialized = true;
                  variable.initialized = true;
                }
                foundVar = true;
                break;
              }
            }
          }
        }
      }
    }

    // 改进的未定义变量检查 - 排除函数调用和声明语句
    const identifierPattern = /\b([a-zA-Z_]\w*)\b/g;
    let identMatch;
    while ((identMatch = identifierPattern.exec(cleanLine)) !== null) {
      const name = identMatch[1];

      // 跳过关键字
      if (isKeyword(name)) continue;

      // 跳过函数声明中的函数名
      const funcDeclCheck = new RegExp(`\\b(int|float|char|void)\\s+${name}\\s*\\(`);
      if (funcDeclCheck.test(cleanLine)) continue;

      // 跳过变量声明中的变量名
      const varDeclCheck = new RegExp(`\\b(const\\s+)?(int|float|char|struct\\s+\\w+)\\s+${name}\\b`);
      if (varDeclCheck.test(cleanLine)) continue;

      // 跳过结构体定义中的结构体名
      const structDefCheck = new RegExp(`^\\s*struct\\s+${name}\\s*\\{`);
      if (structDefCheck.test(cleanLine)) continue;

      // 检查是否是函数调用
      const funcCallCheck = new RegExp(`\\b${name}\\s*\\(`);
      if (funcCallCheck.test(cleanLine)) {
        // 这是函数调用，检查函数是否已定义
        const func = scope.functions.find(f => f.name === name);
        if (!func) {
          diagnostics.push({
            severity: vscode.DiagnosticSeverity.Error,
            range: new vscode.Range(lineIndex, identMatch.index!, lineIndex, identMatch.index! + name.length),
            message: `未定义的函数 '${name}'`,
            source: 'sysyplus'
          });
        }
        continue;
      }

      // 检查变量是否已定义 - 改进函数参数查找
      let isDefined = false;
      
      // 首先检查当前作用域栈
      for (const scopeId of scopeStack) {
        const scopedName = `${scopeId}:${name}`;
        if (declaredVariables.has(scopedName)) {
          isDefined = true;
          // 记录变量使用
          if (!variableUsages.has(name)) {
            variableUsages.set(name, []);
          }
          variableUsages.get(name)!.push({ line: lineNumber, column: identMatch.index! });
          break;
        }
      }
      
      // 如果在当前作用域栈中没找到，检查是否是函数参数
      if (!isDefined) {
        // 查找当前行可能所属的函数
        for (const func of scope.functions) {
          // 检查是否在函数体内（简单判断：当前行在函数声明行之后）
          if (lineNumber > func.line) {
            const funcScopeId = `scope_func_${func.name}`;
            const scopedName = `${funcScopeId}:${name}`;
            if (declaredVariables.has(scopedName)) {
              isDefined = true;
              // 记录变量使用
              if (!variableUsages.has(name)) {
                variableUsages.set(name, []);
              }
              variableUsages.get(name)!.push({ line: lineNumber, column: identMatch.index! });
              break;
            }
          }
        }
      }

      // 检查是否是结构体名
      if (!isDefined && scope.structs.some(s => s.name === name)) {
        isDefined = true;
      }

      if (!isDefined) {
        diagnostics.push({
          severity: vscode.DiagnosticSeverity.Error,
          range: new vscode.Range(lineIndex, identMatch.index!, lineIndex, identMatch.index! + name.length),
          message: `未定义的标识符 '${name}'`,
          source: 'sysyplus'
        });
      }
    }

    // 检查数组访问（只检查赋值或表达式中的 arr[...], 不检查声明）
    const arrayAccessPattern = /\b([a-zA-Z_]\w*)\[\s*(\d+)\s*\]/g;
    let arrayMatch;
    while ((arrayMatch = arrayAccessPattern.exec(cleanLine)) !== null) {
      // 跳过声明语句
      const declPattern = new RegExp(`\\b(const\\s+)?(int|float|char|struct\\s+\\w+)\\s+${arrayMatch[1]}\\s*\\[`);
      if (declPattern.test(cleanLine)) continue;

      const varName = arrayMatch[1];
      const index = parseInt(arrayMatch[2]);
      const variable = scope.variables.find(v => v.name === varName);

      if (variable && variable.isArray && variable.arraySize !== undefined) {
        // 处理多维数组
        let maxIndex: number;
        if (Array.isArray(variable.arraySize)) {
          maxIndex = variable.arraySize[0]; // 只检查第一维
        } else {
          maxIndex = variable.arraySize;
        }
        
        if (index >= maxIndex) {
          diagnostics.push({
            severity: vscode.DiagnosticSeverity.Error,
            range: new vscode.Range(lineIndex, arrayMatch.index!, lineIndex, arrayMatch.index! + arrayMatch[0].length),
            message: `数组 '${varName}' 索引 ${index} 超出范围 [0, ${maxIndex - 1}]`,
            source: 'sysyplus'
          });
        }
      }
    }

    // 改进的死循环检查 - 检查循环体内是否有break或return
    if (/\bwhile\s*\(\s*(1|true)\s*\)/.test(cleanLine)) {
      // 查找循环体
      let hasBreakOrReturn = false;
      let braceCount = 0;
      let foundOpenBrace = false;

      for (let j = lineIndex; j < lines.length; j++) {
        const checkLine = lines[j];
        if (checkLine.includes('{')) {
          foundOpenBrace = true;
          braceCount++;
        }
        if (checkLine.includes('}')) {
          braceCount--;
          if (foundOpenBrace && braceCount === 0) {
            break; // 循环体结束
          }
        }
        if (foundOpenBrace && (/\bbreak\b/.test(checkLine) || /\breturn\b/.test(checkLine))) {
          hasBreakOrReturn = true;
          break;
        }
      }

      if (!hasBreakOrReturn) {
        diagnostics.push({
          severity: vscode.DiagnosticSeverity.Warning,
          range: new vscode.Range(lineIndex, 0, lineIndex, line.length),
          message: "检测到可能的死循环",
          source: 'sysyplus'
        });
      }
    }
  }

  // 检查未使用的变量 - 改为警告而不是错误
  for (const variable of scope.variables) {
    // 跳过结构体成员变量 - 改进检测逻辑
    let isStructMember = false;
    
    // 检查是否在结构体声明的上下文中
    if (variable.line <= scope.structs.length && scope.structs.length > 0) {
      for (const struct of scope.structs) {
        // 检查变量是否定义在结构体内部
        if (struct.members.some(member => member.name === variable.name)) {
          isStructMember = true;
          break;
        }
      }
    }

    // 如果是结构体成员或函数参数，跳过未使用检查
    if (isStructMember) {
      continue;
    }

    const usages = variableUsages.get(variable.name);
    if (!usages || usages.length === 0) {
      diagnostics.push({
        severity: vscode.DiagnosticSeverity.Warning,
        range: new vscode.Range(variable.line - 1, variable.column, variable.line - 1, variable.column + variable.name.length),
        message: `变量 '${variable.name}' 已声明但未使用`,
        source: 'sysyplus'
      });
    }
  }

  // 检查未初始化的变量使用 - 改为警告
  for (const [varName, usages] of variableUsages) {
    for (const scopeId of ['global', currentScopeId]) {
      const scopedName = `${scopeId}:${varName}`;
      const varInfo = declaredVariables.get(scopedName);
      if (varInfo && !varInfo.initialized) {
        for (const usage of usages) {
          if (usage.line > varInfo.line) { // 只检查声明之后的使用
            diagnostics.push({
              severity: vscode.DiagnosticSeverity.Warning, // 改为警告
              range: new vscode.Range(usage.line - 1, usage.column, usage.line - 1, usage.column + varName.length),
              message: `变量 '${varName}' 可能未初始化就被使用`,
              source: 'sysyplus'
            });
          }
        }
        break;
      }
    }
  }

  // 检查未匹配的括号
  for (const brace of braceStack) {
    diagnostics.push({
      severity: vscode.DiagnosticSeverity.Error,
      range: new vscode.Range(brace.line - 1, brace.column, brace.line - 1, brace.column + 1),
      message: "缺少匹配的右大括号 '}'",
      source: 'sysyplus'
    });
  }

  for (const paren of parenthesesStack) {
    diagnostics.push({
      severity: vscode.DiagnosticSeverity.Error,
      range: new vscode.Range(paren.line - 1, paren.column, paren.line - 1, paren.column + 1),
      message: "缺少匹配的右小括号 ')'",
      source: 'sysyplus'
    });
  }

  for (const bracket of squareBracketStack) {
    diagnostics.push({
      severity: vscode.DiagnosticSeverity.Error,
      range: new vscode.Range(bracket.line - 1, bracket.column, bracket.line - 1, bracket.column + 1),
      message: "缺少匹配的右中括号 ']'",
      source: 'sysyplus'
    });
  }

  return { scope, diagnostics };
}

// 诊断提供器
export class SysYPlusDiagnosticProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('sysyplus');
  }

  public async provideDiagnostics(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== 'sysyplus') {
      return;
    }

    const text = document.getText();
    const { diagnostics } = parseCode(text);

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  public dispose(): void {
    this.diagnosticCollection.dispose();
  }
}

// 悬停提供器
export class SysYPlusHoverProvider implements vscode.HoverProvider {
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return;
    }

    const word = document.getText(wordRange);
    const text = document.getText();
    const { scope } = parseCode(text);

    // 先检查是否是结构体类型的变量 - 优先查找当前作用域
    // 获取当前位置所在的作用域信息
    const currentLine = position.line + 1;
    let currentScopeId = 'global';
    
    // 简单的作用域推断：查找最近的函数开始位置
    const textLines = text.split('\n');
    for (let i = position.line; i >= 0; i--) {
      const line = textLines[i];
      const funcMatch = line.match(/\b(int|float|char|void)\s+([a-zA-Z_]\w*)\s*\(/);
      if (funcMatch) {
        // 找到了函数，检查是否在函数体内
        let braceFound = false;
        for (let j = i; j <= position.line; j++) {
          if (textLines[j].includes('{')) {
            braceFound = true;
            break;
          }
        }
        if (braceFound) {
          currentScopeId = `scope_func_${funcMatch[2]}`;
          break;
        }
      }
    }
    
    // 先查找当前作用域的变量，再查找全局作用域
    const variable = scope.variables.find(v => v.name === word && v.scope === currentScopeId) ||
                     scope.variables.find(v => v.name === word);
    
    if (variable) {
      // 检查是否是结构体类型
      if (variable.type.startsWith('struct ')) {
        const structName = variable.type.replace('struct ', '').trim();
        const structDef = scope.structs.find(s => s.name === structName);

        if (structDef) {
          let typeInfo = `**结构体变量**: \`${variable.name}\`\n\n`;
          typeInfo += `**类型**: \`${variable.type}\`\n\n`;

          if (structDef.members.length > 0) {
            typeInfo += '**成员**:\n';
            typeInfo += structDef.members.map(m =>
              `- \`${m.type} ${m.name}\``
            ).join('\n');
          } else {
            typeInfo += '**成员**: 无成员';
          }

          typeInfo += `\n\n**定义位置**: 第 ${variable.line} 行`;

          return new vscode.Hover(typeInfo, wordRange);
        }
      }

      // 普通变量的悬停显示保持不变
      let typeInfo = `**变量**: \`${variable.name}\`\n\n**类型**: \`${variable.type}\``;
      if (variable.isConst) typeInfo += '\n\n**修饰符**: `const`';
      if (variable.isArray) {
        if (Array.isArray(variable.arraySize)) {
          typeInfo += `\n\n**数组大小**: \`[${variable.arraySize.join('][')}]\``;
        } else {
          typeInfo += `\n\n**数组大小**: \`[${variable.arraySize}]\``;
        }
      }
      typeInfo += `\n\n**定义位置**: 第 ${variable.line} 行`;
      typeInfo += `\n\n**作用域**: \`${variable.scope}\``;

      return new vscode.Hover(typeInfo, wordRange);
    }

    // 检查结构体定义
    const struct = scope.structs.find(s => s.name === word);
    if (struct) {
      const structInfo = new vscode.MarkdownString();
      structInfo.appendMarkdown(`**结构体定义**: \`struct ${struct.name}\`\n\n`);
      structInfo.appendMarkdown(`**定义位置**: 第 ${struct.line} 行\n\n`);

      if (struct.members.length > 0) {
        structInfo.appendMarkdown('**成员**:\n');
        struct.members.forEach(member => {
          structInfo.appendMarkdown(`- \`${member.type} ${member.name}\`\n`);
        });
        
        // 计算结构体大小信息（假设每个基本类型为4字节）
        const totalSize = struct.members.length * 4;
        structInfo.appendMarkdown(`\n**估计大小**: ${totalSize} 字节\n`);
        structInfo.appendMarkdown(`**成员数量**: ${struct.members.length}\n`);
      } else {
        structInfo.appendMarkdown('**成员**: 无成员\n');
        structInfo.appendMarkdown('**估计大小**: 0 字节\n');
      }

      // 添加结构体用法示例
      structInfo.appendMarkdown('\n**用法示例**:\n');
      structInfo.appendCodeblock(
        `struct ${struct.name} var;\n` +
        (struct.members.length > 0 ?
          `var.${struct.members[0].name} = /* value */;\n` +
          `// 访问其他成员:\n` +
          struct.members.slice(1, 3).map(m => `var.${m.name} = /* value */;`).join('\n') :
          '// 空结构体'),
        'c'
      );

      return new vscode.Hover(structInfo, wordRange);
    }

    // 检查函数
    const func = scope.functions.find(f => f.name === word);
    if (func) {
      const params = func.parameters.map(p => `${p.type} ${p.name}`).join(', ');
      const typeInfo = `**函数**: \`${func.name}\`\n\n**返回类型**: \`${func.returnType}\`\n\n**参数**: \`(${params})\`\n\n**定义位置**: 第 ${func.line} 行`;

      return new vscode.Hover(typeInfo, wordRange);
    }

    // 检查结构体成员访问
    const dotIndex = document.lineAt(position.line).text.lastIndexOf('.', position.character);
    if (dotIndex >= 0) {
      const structVarRange = document.getWordRangeAtPosition(new vscode.Position(position.line, dotIndex - 1));
      if (structVarRange) {
        const structVarName = document.getText(structVarRange);
        const structVar = scope.variables.find(v => v.name === structVarName && v.type.startsWith('struct '));

        if (structVar) {
          const structName = structVar.type.replace('struct ', '').trim();
          const structDef = scope.structs.find(s => s.name === structName);

          if (structDef) {
            const member = structDef.members.find(m => m.name === word);
            if (member) {
              const memberInfo = `**结构体成员**: \`${member.name}\`\n\n` +
                `**类型**: \`${member.type}\`\n\n` +
                `**所属结构体**: \`${structName}\``;
              return new vscode.Hover(memberInfo, wordRange);
            }
          }
        }
      }
    }

    // 检查关键字
    if (KEYWORDS.has(word)) {
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

      return new vscode.Hover(keywordDescriptions[word] || `**关键字**: \`${word}\``, wordRange);
    }

    return;
  }
}

// 补全提供器
export class SysYPlusCompletionProvider implements vscode.CompletionItemProvider {
  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const text = document.getText();
    const { scope } = parseCode(text);
    const items: vscode.CompletionItem[] = [];

    // 添加关键字补全
    const keywords = [
      'int', 'float', 'char', 'void', 'const', 'struct',
      'if', 'else', 'while', 'for', 'break', 'continue', 'return'
    ];

    keywords.forEach(keyword => {
      const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
      item.detail = 'SysY+ 关键字';
      items.push(item);
    });

    // 添加变量补全
    scope.variables.forEach(variable => {
      const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
      item.detail = `${variable.type} ${variable.name}${variable.isConst ? ' (const)' : ''}`;
      item.documentation = `定义在第 ${variable.line} 行，作用域: ${variable.scope}`;
      items.push(item);
    });

    // 添加函数补全
    scope.functions.forEach(func => {
      const params = func.parameters.map(p => `${p.type} ${p.name}`).join(', ');
      const item = new vscode.CompletionItem(func.name, vscode.CompletionItemKind.Function);
      item.detail = `${func.returnType} ${func.name}(${params})`;
      item.documentation = `定义在第 ${func.line} 行`;
      items.push(item);
    });

    // 添加代码片段
    const mainSnippet = new vscode.CompletionItem('main', vscode.CompletionItemKind.Snippet);
    mainSnippet.insertText = new vscode.SnippetString('int main() {\n\t${1:// 代码}\n\treturn 0;\n}');
    mainSnippet.detail = '主函数模板';
    items.push(mainSnippet);

    return items;
  }
}

// 定义提供器
export class SysYPlusDefinitionProvider implements vscode.DefinitionProvider {
  public provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return;
    }

    const word = document.getText(wordRange);
    const text = document.getText();
    const { scope } = parseCode(text);

    // 查找变量定义
    const variable = scope.variables.find(v => v.name === word);
    if (variable) {
      return new vscode.Location(
        document.uri,
        new vscode.Position(variable.line - 1, variable.column)
      );
    }

    // 查找函数定义
    const func = scope.functions.find(f => f.name === word);
    if (func) {
      return new vscode.Location(
        document.uri,
        new vscode.Position(func.line - 1, func.column)
      );
    }

    return;
  }
}

// 格式化提供器
export class SysYPlusDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
  public provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const text = document.getText();
    const lines = text.split('\n');
    const formattedLines: string[] = [];
    let indentLevel = 0;
    const indent = options.insertSpaces ? ' '.repeat(options.tabSize || 2) : '\t';

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine.endsWith('}')) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      if (trimmedLine !== '') {
        formattedLines.push(indent.repeat(indentLevel) + trimmedLine);
      } else {
        formattedLines.push('');
      }

      if (trimmedLine.endsWith('{')) {
        indentLevel++;
      }
    }

    const formattedText = formattedLines.join('\n');
    return [vscode.TextEdit.replace(
      new vscode.Range(0, 0, document.lineCount, 0),
      formattedText
    )];
  }
}

// 代码操作提供器
export class SysYPlusCodeActionProvider implements vscode.CodeActionProvider {
  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    context.diagnostics.forEach(diagnostic => {
      if (diagnostic.source === 'sysyplus') {
        // 缺少分号的快速修复
        if (diagnostic.message.includes("缺少分号 ';'")) {
          const action = new vscode.CodeAction(
            "在行尾添加分号",
            vscode.CodeActionKind.QuickFix
          );
          action.edit = new vscode.WorkspaceEdit();
          // 在该行末尾插入分号
          action.edit.insert(
            document.uri,
            new vscode.Position(diagnostic.range.start.line, diagnostic.range.end.character),
            ';'
          );
          actions.push(action);
        }

        if (diagnostic.message.includes('未定义的标识符')) {
          const match = diagnostic.message.match(/'([^']+)'/);
          if (match) {
            const varName = match[1];
            const action = new vscode.CodeAction(
              `声明变量 'int ${varName}'`,
              vscode.CodeActionKind.QuickFix
            );
            action.edit = new vscode.WorkspaceEdit();
            action.edit.insert(
              document.uri,
              new vscode.Position(diagnostic.range.start.line, 0),
              `int ${varName};\n`
            );
            actions.push(action);
          }
        }

        if (diagnostic.message.includes('是关键字')) {
          const match = diagnostic.message.match(/'([^']+)'/);
          if (match) {
            const varName = match[1];
            const action = new vscode.CodeAction(
              `重命名为 '${varName}_var'`,
              vscode.CodeActionKind.QuickFix
            );
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(
              document.uri,
              diagnostic.range,
              `${varName}_var`
            );
            actions.push(action);
          }
        }

        // 添加将错误改为警告的快速修复
        if (diagnostic.message.includes('可能未初始化就被使用')) {
          const action = new vscode.CodeAction(
            '忽略此警告',
            vscode.CodeActionKind.QuickFix
          );
          action.edit = new vscode.WorkspaceEdit();
          // 这里可以添加注释来忽略警告
          actions.push(action);
        }
      }
    });

    return actions;
  }
}

// 检查本行是否在结构体声明内
const isInStructDeclaration = (line: string): boolean => {
  return /^\s*struct\s+[a-zA-Z_]\w*\s*\{/.test(line) ||
    /^\s*\}/.test(line) ||
    (/^\s*(int|float|char|struct\s+\w+)\s+[a-zA-Z_]\w*(\[\s*\d+\s*\])?\s*;/.test(line) &&
      /struct\s+[a-zA-Z_]\w*\s*\{/.test(line));
};