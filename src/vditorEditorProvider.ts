import * as vscode from 'vscode';
import * as path from 'path';
import { ImageSaver } from './imageSaver';
import { VditorConfig } from './config';

export class VditorEditorProvider implements vscode.CustomTextEditorProvider {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new VditorEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(
			VditorEditorProvider.viewType,
			provider,
			{ webviewOptions: { retainContextWhenHidden: true } });
		return providerRegistration;
	}

	public static readonly viewType = 'vscode-vditor.vditor';
	public static keyVditorOptions = 'vditor.options';
	private clientLock: boolean = false;
	private content: string = '';

	constructor(
		private readonly context: vscode.ExtensionContext
	) {

		context.globalState.setKeysForSync([VditorEditorProvider.keyVditorOptions]);
	}

	/**
	 * Called when our custom editor is opened.
	 * 
	 * 
	 */
	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document);

		function updateWebview() {
			webviewPanel.webview.postMessage({
				type: 'update',
				text: document.getText(),
			});
		}

		// Hook up event handlers so that we can synchronize the webview with the text document.
		//
		// The text document acts as our model, so we have to sync change in the document to our
		// editor and sync changes in the editor back to the document.
		// 
		// Remember that a single text document can also be shared between multiple custom
		// editors (this happens for example when you split a custom editor)
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString()) {

				if (e.contentChanges.length === 0) {
					//没有内容改变返回
					return;
				}

				const text = document.getText();
				if (text === this.content) { return; }


				if (this.clientLock === true) {
					//如果是保存中,且有内容改变
					this.clientLock = false;
					return;
				}
				updateWebview();
			}
		});

		const saveDocumentSubscription = vscode.workspace.onDidSaveTextDocument(e => {
			if (e.uri.toString() === document.uri.toString()) {
				//暂时没什么需要
			}
		});

		// Make sure we get rid of the listener when our editor is closed.
		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
			saveDocumentSubscription.dispose();
		});

		// Receive message from the webview.
		webviewPanel.webview.onDidReceiveMessage(e => {
			switch (e.type) {
				case 'ready':
					{
						this.clientLock = false;
						this.content = document.getText();
						updateWebview();
					}
					return;
				case 'refresh':
					updateWebview();
					return;
				case "save":
					this.onSave(document, e.content);
					return;
				case 'input':
					this.onInput(document, e.content);
					return;
				case 'focus':
					this.onFocus(document, e.content);
					return;
				case 'blur':
					this.onBlur(document, e.content);
					return;
				case 'esc':
					this.onEsc(document, e.content);
					return;
				case 'ctrlEnter':
					this.onCtrlEnter(document, e.content);
					return;
				case 'select':
					this.onSelect(document, e.content);
					return;
				case 'upload':
					this.onUpload(webviewPanel, document, e.files);
					return;
				case 'paste':
					this.onPaste(webviewPanel, document);
					return;
				case 'pasteContent':
					this.onPasteContent(webviewPanel, document, e.content);
					return;
				case 'sourceCode':
					{
						vscode.commands.executeCommand('vscode.openWith', document.uri, "default", vscode.ViewColumn.Beside);
					}
					return;
				case 'link':
					{
						let url = e.href;
						if (!/^http/.test(url)) {
							url = path.resolve(document.uri.fsPath, '..', url);
						}
						vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(url));
					}
					return;
				case "config":
					{
						this.context.globalState.update(VditorEditorProvider.keyVditorOptions, e.options);
					}
					return;
				case 'info':
					vscode.window.showInformationMessage(e.content);
					return;
				case 'warn':
					vscode.window.showWarningMessage(e.content);
					return;
				case 'error':
					vscode.window.showErrorMessage(e.content);
					return;
			}
		});
	}


	/**
	 * Get the static html used for the editor webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview, document: vscode.TextDocument): string {


		var options: any = this.context.globalState.get(VditorEditorProvider.keyVditorOptions);
		options = options || {};
		options.version = VditorConfig.vditorVersion;
		options.autoSaveImage = VditorConfig.autoSaveImage;
		options.themePath = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'assets', 'content-theme')).toString();

		// Local path to script and css for the webview
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'assets', 'app.js'));

		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'assets', 'vditor.css'));

		//用于图片显示
		const baseHref = path.dirname(
			webview.asWebviewUri(vscode.Uri.file(document.uri.fsPath)).toString()
		) + '/';


		return /* html */`
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8"> 
				<meta name="viewport" content="width=device-width, initial-scale=1.0"> 
				<meta http-equiv="X-UA-Compatible" content="ie=edge">
				<base href="${baseHref}" />
				<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/vditor${options.version}/dist/index.css" /> 
				<link href="${styleMainUri}" rel="stylesheet" />
				<title>Vditor</title>
			</head>
			<body>
				<div id="vditor"></div>
				<script>
				(function (global) {
					global.vditorOptions = ${JSON.stringify(options)};
				}).call(this, window);
				</script>
				<script src="https://cdn.jsdelivr.net/npm/vditor${options.version}/dist/index.min.js"></script>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}

	private onSave(document: vscode.TextDocument, content: string) {
		this.clientLock = true;
		this.updateTextDocument(document, content);
	}

	private onInput(document: vscode.TextDocument, content: string) {
		this.onSave(document, content);
	}

	private onSelect(document: vscode.TextDocument, content: any) {
		vscode.window.activeTextEditor?.edit(builder => {
			builder.replace(vscode.window.activeTextEditor!.selection, content);
		});
	}
	private onCtrlEnter(document: vscode.TextDocument, content: any) {

	}
	private onEsc(document: vscode.TextDocument, content: any) {

	}
	private onBlur(document: vscode.TextDocument, content: any) {

	}
	private onFocus(document: vscode.TextDocument, content: any) {

	}

	private onUpload(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument, files: any[]) {
		var imageSaver = ImageSaver.getInstance();
		imageSaver.document = document;
		var result = files.map((f: any) => {
			return imageSaver.copyFile(f);
		});
		webviewPanel.webview.postMessage({
			type: 'uploaded',
			files: result,
		});
	}

	private onPaste(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument) {
		var imageSaver = ImageSaver.getInstance();
		imageSaver.document = document;
		imageSaver.pasteTextStr((data) => {
			webviewPanel.webview.postMessage({
				type: 'pasted',
				content: data,
			});
		});
	}

	private async onPasteContent(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument, content: any) {
		var imageSaver = ImageSaver.getInstance();
		imageSaver.document = document;
		var data = await imageSaver.pasteHtmlOrText(content);
		webviewPanel.webview.postMessage({
			type: 'pasted',
			content: data,
		});
	}


	/**
 * Write out the json to a given document.
 */
	private updateTextDocument(document: vscode.TextDocument, content: any) {
		const text = document.getText();
		if (text === content) { return; }
		this.content = content;
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			document.uri,
			new vscode.Range(0, 0, document.lineCount, 0),
			content);
		return vscode.workspace.applyEdit(edit);
	}
}
