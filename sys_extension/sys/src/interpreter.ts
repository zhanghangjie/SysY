// sys 语言简单解释器

export interface SysVariable {
    name: string;
    type: 'int' | 'string' | 'bool' | 'float' | 'double';
    value: any;
    isConst: boolean;
}

export interface SysStructMember extends SysVariable {
    // 结构体成员，继承自 SysVariable
}

export interface SysStruct {
    name: string;
    members: SysStructMember[];
}

export class SysInterpreter {
    private variables: Map<string, SysVariable> = new Map();
    private structs: Map<string, SysStruct> = new Map(); // 新增：用于存储解析后的结构体
    private isInStructDefinition: boolean = false;
    private currentStructName: string | null = null;

    // 解析变量声明: int const a = 2; 或 int a = 2; 或 int a;
    parseVariableDeclaration(line: string): SysVariable | null {
        // 匹配模式: (type) (modifier?) (name) (= (value))?
        const match = line.match(/^\s*(int|string|bool|float|double)\s+(const\s+|var\s+|let\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(=\s*(.+))?;?\s*$/);

        if (!match) return null;

        const [, type, modifier, name, , valueStr] = match; // 注意这里多了一个空的捕获组，因为括号导致
        const isConst = modifier?.trim() === 'const';

        let value: any = undefined; // 默认值设为 undefined
        if (valueStr !== undefined) { // 只有当有赋值时才解析值
            try {
                value = this.parseValue(valueStr.trim(), type as any);
            } catch (error: any) {
                throw new Error(`Invalid value for ${name}: ${valueStr}`);
            }
        }

        return {
            name,
            type: type as any,
            value,
            isConst
        };
    }

    // 解析值
    private parseValue(valueStr: string, type: string): any {
        switch (type) {
            case 'int':
                const intVal = parseInt(valueStr);
                if (isNaN(intVal)) throw new Error(`Invalid integer: ${valueStr}`);
                return intVal;

            case 'float':
            case 'double':
                const floatVal = parseFloat(valueStr);
                if (isNaN(floatVal)) throw new Error(`Invalid number: ${valueStr}`);
                return floatVal;

            case 'bool':
                if (valueStr === 'true') return true;
                if (valueStr === 'false') return false;
                throw new Error(`Invalid boolean: ${valueStr}`);

            case 'string':
                if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
                    return valueStr.slice(1, -1);
                }
                throw new Error(`Invalid string: ${valueStr}`);

            default:
                throw new Error(`Unknown type: ${type}`);
        }
    }

    // 解析结构体声明的头部: struct Name {
    parseStructDeclarationHeader(line: string): string | null {
        const match = line.match(/^\s*struct\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*{\s*$/);
        if (match) {
            return match[1]; // 返回结构体名称
        }
        return null;
    }

    // 执行单行代码
    execute(line: string): string {
        const trimmedLine = line.trim();

        if (this.isInStructDefinition) {
            // 如果在结构体定义内部，尝试解析成员变量
            if (trimmedLine === '}') {
                this.isInStructDefinition = false;
                this.currentStructName = null;
                return `✓ 结构体定义结束`;
            }

            const member = this.parseVariableDeclaration(trimmedLine); // 利用现有变量解析逻辑
            if (member && this.currentStructName) {
                const currentStruct = this.structs.get(this.currentStructName);
                if (currentStruct) {
                    currentStruct.members.push(member as SysStructMember);
                    return `✓ 添加成员 ${member.name} 到结构体 ${this.currentStructName}`;
                } else {
                    return `❌ 错误: 结构体 ${this.currentStructName} 不存在`;
                }
            } else {
                return `❌ 无法解析结构体成员: ${line}`;
            }
        } else {
            // 不在结构体定义内部，尝试解析结构体头部或普通变量声明
            const structName = this.parseStructDeclarationHeader(trimmedLine);
            if (structName) {
                if (this.structs.has(structName)) {
                    return `❌ 错误: 结构体 ${structName} 已存在`;
                }
                this.structs.set(structName, { name: structName, members: [] });
                this.isInStructDefinition = true;
                this.currentStructName = structName;
                return `✓ 开始定义结构体 ${structName}`;
            }

            try {
                const variable = this.parseVariableDeclaration(trimmedLine);
                if (variable) {
                    this.variables.set(variable.name, variable);
                    return `✓ ${variable.name} = ${variable.value} (${variable.type}${variable.isConst ? ', const' : ''})`;
                }

                return `❌ 无法解析: ${line}`;
            } catch (error: any) {
                return `❌ 错误: ${error.message}`;
            }
        }
    }

    // 获取所有变量
    getVariables(): SysVariable[] {
        return Array.from(this.variables.values());
    }

    // 获取所有结构体
    getStructs(): SysStruct[] {
        return Array.from(this.structs.values());
    }

    // 清空变量和结构体
    clear() {
        this.variables.clear();
        this.structs.clear();
        this.isInStructDefinition = false;
        this.currentStructName = null;
    }
} 