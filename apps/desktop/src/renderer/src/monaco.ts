import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import { PM_DTS } from './pm-types'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

// Monaco local (sem CDN): os workers saem do próprio bundle.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

monaco.editor.defineTheme('jeff-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e1e1e',
    'editorGutter.background': '#1e1e1e',
    'editor.lineHighlightBackground': '#262626',
    'editorLineNumber.foreground': '#5a5a5a'
  }
})

monaco.editor.defineTheme('jeff-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f5f5f5' }
})

// autocompletar da API pm nos scripts
monaco.typescript.javascriptDefaults.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ES2020,
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: false,
  lib: ['es2020']
})
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
monaco.typescript.javascriptDefaults.addExtraLib(PM_DTS, 'ts:pm.d.ts')

loader.config({ monaco })

export { monaco }
