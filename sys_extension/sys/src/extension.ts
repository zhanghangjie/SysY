// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {
	SysYPlusDiagnosticProvider,
	SysYPlusHoverProvider,
	SysYPlusCompletionProvider,
	SysYPlusDefinitionProvider,
	SysYPlusDocumentFormattingEditProvider,
	SysYPlusCodeActionProvider
} from './sysyplus-language';

let diagnosticProvider: SysYPlusDiagnosticProvider;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('SysY+ Language Support extension is now active!');

	// 初始化诊断提供器
	diagnosticProvider = new SysYPlusDiagnosticProvider();

	// 注册语言服务提供器
	const hoverProvider = vscode.languages.registerHoverProvider('sysyplus', new SysYPlusHoverProvider());
	const completionProvider = vscode.languages.registerCompletionItemProvider('sysyplus', new SysYPlusCompletionProvider(), '.');
	const definitionProvider = vscode.languages.registerDefinitionProvider('sysyplus', new SysYPlusDefinitionProvider());
	const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider('sysyplus', new SysYPlusDocumentFormattingEditProvider());
	const codeActionProvider = vscode.languages.registerCodeActionsProvider('sysyplus', new SysYPlusCodeActionProvider());

	// 注册命令
	const helloWorld = vscode.commands.registerCommand('sysyplus.helloWorld', () => {
		vscode.window.showInformationMessage('Hello from SysY+ Language Support!');
	});

	// 注册运行 SysY+ 代码命令
	const runSysYPlusCode = vscode.commands.registerCommand('sysyplus.runCode', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId === 'sysyplus') {
			const text = editor.document.getText();

			// 显示代码执行结果（这里可以集成实际的解释器）
			const result = `SysY+ 代码运行结果:\n\n代码行数: ${editor.document.lineCount}\n字符数: ${text.length}\n\n代码内容:\n${text}`;

			// 在新的编辑器中显示结果
			const doc = await vscode.workspace.openTextDocument({
				content: result,
				language: 'plaintext'
			});
			await vscode.window.showTextDocument(doc);
		} else {
			vscode.window.showWarningMessage('请在 .syy 或 .sys 文件中运行此命令');
		}
	});

	// 格式化文档命令
	const formatDocument = vscode.commands.registerCommand('sysyplus.formatDocument', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId === 'sysyplus') {
			await vscode.commands.executeCommand('editor.action.formatDocument');
			vscode.window.showInformationMessage('SysY+ 代码格式化完成!');
		} else {
			vscode.window.showWarningMessage('请在 SysY+ 文件中使用此命令');
		}
	});

	// 显示AST命令
	const showAST = vscode.commands.registerCommand('sysyplus.showAST', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId === 'sysyplus') {
			const text = editor.document.getText();

			// 这里可以实现真正的AST解析
			const astInfo = generateSimpleAST(text);

			const doc = await vscode.workspace.openTextDocument({
				content: JSON.stringify(astInfo, null, 2),
				language: 'json'
			});
			await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
			vscode.window.showInformationMessage('AST 已在右侧面板显示');
		} else {
			vscode.window.showWarningMessage('请在 SysY+ 文件中使用此命令');
		}
	});

	// 验证语法命令
	const validateSyntax = vscode.commands.registerCommand('sysyplus.validateSyntax', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId === 'sysyplus') {
			await diagnosticProvider.provideDiagnostics(editor.document);

			const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
			const errorCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
			const warningCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;

			if (errorCount === 0 && warningCount === 0) {
				vscode.window.showInformationMessage('✅ 语法检查通过，没有发现错误！');
			} else {
				vscode.window.showWarningMessage(`⚠️ 发现 ${errorCount} 个错误，${warningCount} 个警告`);
			}
		} else {
			vscode.window.showWarningMessage('请在 SysY+ 文件中使用此命令');
		}
	});

	// 监听文档变化，自动进行语法检查
	const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(async (event) => {
		if (event.document.languageId === 'sysyplus') {
			// 延迟执行，避免频繁检查
			const config = vscode.workspace.getConfiguration('sysyplus');
			const delay = config.get<number>('diagnosticsDelay', 500);

			setTimeout(async () => {
				if (config.get<boolean>('enableDiagnostics', true)) {
					await diagnosticProvider.provideDiagnostics(event.document);
				}
			}, delay);
		}
	});

	// 监听文档打开
	const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument(async (document) => {
		if (document.languageId === 'sysyplus') {
			const config = vscode.workspace.getConfiguration('sysyplus');
			if (config.get<boolean>('enableDiagnostics', true)) {
				await diagnosticProvider.provideDiagnostics(document);
			}
		}
	});

	// 监听文档保存，自动格式化
	const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument(async (document) => {
		if (document.languageId === 'sysyplus') {
			const config = vscode.workspace.getConfiguration('sysyplus');
			if (config.get<boolean>('enableAutoFormat', true)) {
				const editor = vscode.window.activeTextEditor;
				if (editor && editor.document === document) {
					await vscode.commands.executeCommand('editor.action.formatDocument');
				}
			}
		}
	});

	// 状态栏显示语言信息
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = "$(symbol-class) SysY+";
	statusBarItem.tooltip = "SysY+ Language Support";
	statusBarItem.command = 'sysyplus.validateSyntax';

	const updateStatusBar = () => {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId === 'sysyplus') {
			statusBarItem.show();
		} else {
			statusBarItem.hide();
		}
	};

	const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(updateStatusBar);
	updateStatusBar();

	// 将所有注册的命令和提供器添加到订阅列表
	context.subscriptions.push(
		helloWorld,
		runSysYPlusCode,
		formatDocument,
		showAST,
		validateSyntax,
		hoverProvider,
		completionProvider,
		definitionProvider,
		formattingProvider,
		codeActionProvider,
		onDidChangeTextDocument,
		onDidOpenTextDocument,
		onDidSaveTextDocument,
		onDidChangeActiveTextEditor,
		statusBarItem,
		diagnosticProvider
	);

	console.log('SysY+ Language Support: All features activated successfully!');
}

// 简单的AST生成函数
function generateSimpleAST(code: string): any {
	const lines = code.split('\n').filter(line => line.trim() !== '');
	const ast = {
		type: 'Program',
		body: [],
		metadata: {
			totalLines: lines.length,
			timestamp: new Date().toISOString()
		}
	};

	for (const line of lines) {
		const trimmedLine = line.trim();

		// 函数声明
		const funcMatch = trimmedLine.match(/\b(int|float|char|void)\s+([a-zA-Z_]\w*)\s*\(/);
		if (funcMatch) {
			(ast.body as any[]).push({
				type: 'FunctionDeclaration',
				returnType: funcMatch[1],
				name: funcMatch[2],
				line: trimmedLine
			});
			continue;
		}

		// 变量声明
		const varMatch = trimmedLine.match(/\b(const\s+)?(int|float|char)\s+([a-zA-Z_]\w*)/);
		if (varMatch) {
			(ast.body as any[]).push({
				type: 'VariableDeclaration',
				isConst: varMatch[1] !== undefined,
				dataType: varMatch[2],
				name: varMatch[3],
				line: trimmedLine
			});
			continue;
		}

		// 控制流语句
		if (/\b(if|while|for|return)\b/.test(trimmedLine)) {
			(ast.body as any[]).push({
				type: 'ControlStatement',
				line: trimmedLine
			});
			continue;
		}

		// 其他语句
		if (trimmedLine !== '{' && trimmedLine !== '}' && !trimmedLine.startsWith('//')) {
			(ast.body as any[]).push({
				type: 'Statement',
				line: trimmedLine
			});
		}
	}

	return ast;
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (diagnosticProvider) {
		diagnosticProvider.dispose();
	}
	console.log('SysY+ Language Support extension deactivated');
}
