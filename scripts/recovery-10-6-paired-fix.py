from pathlib import Path
path = Path('apps/web/src/domain/templateAssemblySeams.ts')
text = path.read_text()
text = text.replace('    const totalLength = edgeRangeSequenceLength([piece], ranges);\n', '')
text = text.replace('    void totalLength;\n', '')
path.write_text(text)
print('Prompt 10.6 paired-copy fix applied')
