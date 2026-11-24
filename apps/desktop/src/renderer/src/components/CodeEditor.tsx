import Editor from '@monaco-editor/react'
import '../monaco'
import { useStore } from '../store'

interface Props {
  value: string
  language: string
  onChange?(v: string): void
  readOnly?: boolean
  wordWrap?: boolean
}

export function CodeEditor({ value, language, onChange, readOnly, wordWrap }: Props) {
  const theme = useStore((s) => s.theme)
  return (
    <div className="code-editor">
      <Editor
        value={value}
        language={language}
        theme={theme === 'dark' ? 'jeff-dark' : 'jeff-light'}
        onChange={(v) => onChange?.(v ?? '')}
        options={{
          readOnly,
          domReadOnly: readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "'Cascadia Code', Consolas, monospace",
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: wordWrap ? 'on' : 'off',
          folding: true,
          renderLineHighlight: readOnly ? 'none' : 'line',
          tabSize: 2,
          stickyScroll: { enabled: false },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
        }}
      />
    </div>
  )
}
