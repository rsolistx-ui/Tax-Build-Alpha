import { useEffect, useRef, useState, useCallback, Fragment } from 'react';
import { HyperFormula } from 'hyperformula';
import { TAX_FUNCTIONS, TaxFunctionRegistry } from '@/lib/tax-functions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Save, Download, Upload, RefreshCw, Calculator, FileSpreadsheet, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkpaperCell {
  row: number;
  col: number;
  value: string;
  formula?: string;
  isEditing?: boolean;
  error?: string;
  isFormula?: boolean;
  functionName?: string;
}

interface WorkpaperSheet {
  name: string;
  cells: Map<string, WorkpaperCell>;
  rows: number;
  cols: number;
}

const DEFAULT_ROWS = 100;
const DEFAULT_COLS = 26;

const COLUMN_LABELS = Array.from({ length: DEFAULT_COLS }, (_, i) =>
  String.fromCharCode(65 + i)
);

function cellKey(row: number, col: number): string {
  return `${COLUMN_LABELS[col]}${row + 1}`;
}

function parseCellKey(key: string): { row: number; col: number } | null {
  const match = key.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const col = match[1].split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const row = parseInt(match[2], 10) - 1;
  return { row, col };
}

function hfAddress(cellKey: string) {
  const parsed = parseCellKey(cellKey);
  if (!parsed) return { col: 0, row: 0, sheet: 0 };
  return { col: parsed.col, row: parsed.row, sheet: 0 };
}

export function TaxWorkpaper({ clientId, taxYear }: { clientId: string; taxYear: number }) {
  const hfRef = useRef<ReturnType<typeof HyperFormula.buildFromSheets> | null>(null);
  const [sheets, setSheets] = useState<Map<string, WorkpaperSheet>>(new Map());
  const [activeSheet, setActiveSheet] = useState<string>('1040');
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [formulaBar, setFormulaBar] = useState<string>('');
  const [isCalculating, setIsCalculating] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [functionSearch, setFunctionSearch] = useState('');
  const [showFunctionPicker, setShowFunctionPicker] = useState(false);

  useEffect(() => {
    const defaultNames = ['1040', 'SchC', 'SchD', 'SchE', 'M1', 'State'];
    const storageKey = `workpaper-${clientId}-${taxYear}`;

    let savedData: Record<string, any> | null = null;
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try { savedData = JSON.parse(raw); } catch { /* ignore corrupted data */ }
    }

    const sheetNames = savedData ? Object.keys(savedData).filter(name => name !== 'activeSheet') : defaultNames;

    const hfSheets: Record<string, string[][]> = {};
    sheetNames.forEach(name => { hfSheets[name] = [['']]; });
    const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: 'gpl-v3' });
    hfRef.current = hf;

    const newSheets = new Map<string, WorkpaperSheet>();
    sheetNames.forEach((name, sheetIdx) => {
      const cells = new Map<string, WorkpaperCell>();
      const data = savedData?.[name];
      if (data) {
        Object.entries(data.cells || {}).forEach(([ck, cellData]) => {
          const cell = cellData as WorkpaperCell;
          cells.set(ck, { ...cell });
          const parsed = parseCellKey(ck);
          if (parsed && cell.formula) {
            hf.setCellContents({ sheet: sheetIdx, row: parsed.row, col: parsed.col }, cell.formula);
          }
        });
      }
      newSheets.set(name, { name, cells, rows: data?.rows ?? DEFAULT_ROWS, cols: data?.cols ?? DEFAULT_COLS });
    });

    sheetNames.forEach((name, sheetIdx) => {
      const sheet = newSheets.get(name);
      if (!sheet) return;
      const refreshed = new Map(sheet.cells);
      for (const [ck, cell] of sheet.cells.entries()) {
        if (!cell.formula) continue;
        const parsed = parseCellKey(ck);
        if (!parsed) continue;
        const value = hf.getCellValue({ sheet: sheetIdx, row: parsed.row, col: parsed.col });
        refreshed.set(ck, { ...cell, value: value !== null && value !== undefined ? String(value) : '' });
      }
      newSheets.set(name, { ...sheet, cells: refreshed });
    });

    setSheets(newSheets);
    const active = savedData?.activeSheet;
    if (typeof active === 'string' && sheetNames.includes(active)) setActiveSheet(active);

    return () => {
      hfRef.current?.destroy();
      hfRef.current = null;
    };
  }, [clientId, taxYear]);

  const persistSheets = useCallback((newSheets: Map<string, WorkpaperSheet>, active: string) => {
    try {
      const serializable: Record<string, any> = { activeSheet: active };
      newSheets.forEach((sheet, name) => {
        serializable[name] = {
          cells: Object.fromEntries(sheet.cells.entries()),
          rows: sheet.rows,
          cols: sheet.cols,
        };
      });
      localStorage.setItem(`workpaper-${clientId}-${taxYear}`, JSON.stringify(serializable));
    } catch { /* storage full or unavailable */ }
  }, [clientId, taxYear]);

  const evaluateCell = useCallback(async (sheetName: string, ck: string, value: string) => {
    const hf = hfRef.current;
    if (!hf) return;

    setIsCalculating(true);
    try {
      const addr = hfAddress(ck);
      addr.sheet = Array.from(hf.getSheetNames()).indexOf(sheetName);
      hf.setCellContents(addr, value);
      const result = hf.getCellValue(addr);

      setSheets(prev => {
        const newSheets = new Map(prev);
        const sheet = newSheets.get(sheetName);
        if (sheet) {
          const newCells = new Map(sheet.cells);
          const cell = newCells.get(ck) || { row: 0, col: 0, value: '' };
          const parsed = parseCellKey(ck);
          if (parsed) {
            cell.row = parsed.row;
            cell.col = parsed.col;
          }
          cell.value = result !== null && result !== undefined ? String(result) : '';
          cell.formula = value.startsWith('=') ? value : undefined;
          cell.isFormula = value.startsWith('=');
          cell.error = undefined;
          newCells.set(ck, cell);
          newSheets.set(sheetName, { ...sheet, cells: newCells });
        }
        return newSheets;
      });

      setErrors(prev => {
        const newErrors = new Map(prev);
        newErrors.delete(ck);
        return newErrors;
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Calculation error';
      setErrors(prev => {
        const newErrors = new Map(prev);
        newErrors.set(ck, errorMsg);
        return newErrors;
      });
    } finally {
      setIsCalculating(false);
    }
  }, []);

  const handleCellChange = useCallback((ck: string, value: string) => {
    setFormulaBar(value);
    setSelectedCell(ck);
    evaluateCell(activeSheet, ck, value);
  }, [activeSheet, evaluateCell]);

  const handleCellSelect = useCallback((ck: string) => {
    const sheet = sheets.get(activeSheet);
    const cell = sheet?.cells.get(ck);
    setSelectedCell(ck);
    setFormulaBar(cell?.formula || cell?.value || '');
  }, [activeSheet, sheets]);

  const handleSave = useCallback(async () => {
    const sheet = sheets.get(activeSheet);
    if (!sheet) return;

    const rows: string[][] = [];
    for (let r = 0; r < DEFAULT_ROWS; r++) {
      const row: string[] = [];
      for (let c = 0; c < DEFAULT_COLS; c++) {
        const cell = sheet.cells.get(cellKey(r, c));
        row.push(cell?.value || '');
      }
      if (row.some(v => v)) rows.push(row);
    }

    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');

    try {
      if ('showSaveFilePicker' in window) {
        const pickerOpts: any = {
          suggestedName: `${activeSheet}-${new Date().toISOString().split('T')[0]}.csv`,
          types: [{ description: 'CSV Files', accept: { 'text/csv': ['.csv'] } }],
        };
        const handle = await (window as any).showSaveFilePicker(pickerOpts);
        const writable = await handle.createWritable();
        await writable.write(csv);
        await writable.close();
        setLastSaved(new Date());
        persistSheets(sheets, activeSheet);
        return;
      }
    } catch { /* fall through to blob download */ }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSheet}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setLastSaved(new Date());
    persistSheets(sheets, activeSheet);
  }, [activeSheet, sheets, persistSheets]);

  const handleExport = useCallback(() => {
    const sheet = sheets.get(activeSheet);
    if (!sheet) return;

    const rows: string[][] = [];
    for (let r = 0; r < DEFAULT_ROWS; r++) {
      const row: string[] = [];
      for (let c = 0; c < DEFAULT_COLS; c++) {
        const cell = sheet.cells.get(cellKey(r, c));
        row.push(cell?.value || '');
      }
      if (row.some(v => v)) rows.push(row);
    }

    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSheet}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeSheet, sheets]);

  const handlePdfExport = useCallback(() => {
    const sheet = sheets.get(activeSheet);
    if (!sheet) return;

    const rows: string[][] = [];
    for (let r = 0; r < DEFAULT_ROWS; r++) {
      const row: string[] = [];
      for (let c = 0; c < DEFAULT_COLS; c++) {
        const cell = sheet.cells.get(cellKey(r, c));
        row.push(cell?.value || '');
      }
      if (row.some(v => v)) rows.push(row);
    }

    const html = `
      <html><head><meta charset="utf-8">
      <style>
        body { font-family: monospace; font-size: 10px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 2px 6px; text-align: right; }
        th { background: #f0f0f0; }
      </style></head><body>
      <h2>${activeSheet} - ${clientId} - ${taxYear}</h2>
      <table>${rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('')}</table>
      </body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url);
    if (printWindow) {
      printWindow.onload = () => { printWindow.print(); };
    }
    URL.revokeObjectURL(url);
  }, [activeSheet, sheets, clientId, taxYear]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = text.split('\n').map(row => row.split(',').map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"')));

      setSheets(prev => {
        const newSheets = new Map(prev);
        const sheet = newSheets.get(activeSheet);
        if (!sheet) return prev;
        const newCells = new Map(sheet.cells);
        rows.forEach((row, r) => {
          row.forEach((cell, c) => {
            if (c < DEFAULT_COLS && r < DEFAULT_ROWS) {
              const key = cellKey(r, c);
              newCells.set(key, {
                row: r,
                col: c,
                value: cell,
                isFormula: cell.startsWith('='),
                formula: cell.startsWith('=') ? cell : undefined,
              });
            }
          });
        });
        newSheets.set(activeSheet, { ...sheet, cells: newCells });
        persistSheets(newSheets, activeSheet);
        return newSheets;
      });
    };
    reader.readAsText(file);
  }, [activeSheet, persistSheets]);

  const filteredFunctions = TAX_FUNCTIONS.filter(fn =>
    fn.name.toLowerCase().includes(functionSearch.toLowerCase()) ||
    fn.description.toLowerCase().includes(functionSearch.toLowerCase()) ||
    fn.category.toLowerCase().includes(functionSearch.toLowerCase())
  );

  const groupedFunctions = filteredFunctions.reduce((acc, fn) => {
    if (!acc[fn.category]) acc[fn.category] = [];
    acc[fn.category].push(fn);
    return acc;
  }, {} as Record<string, TaxFunctionRegistry[]>);

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)] bg-[var(--color-card)]">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          <span className="font-medium">Tax Workpaper</span>
          <Badge className="ml-1">{activeSheet}</Badge>
        </div>

        <div className="flex-1" />

        <div className="relative flex-1 max-w-md">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFunctionPicker(!showFunctionPicker)}
            className="w-full justify-start gap-2"
          >
            <Calculator className="h-3.5 w-3.5" />
            {functionSearch ? `Functions: ${functionSearch}` : 'Insert Function...'}
            {showFunctionPicker && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
          </Button>

          {showFunctionPicker && (
            <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-lg max-h-96 overflow-auto z-10">
              <Input
                placeholder="Search functions..."
                value={functionSearch}
                onChange={e => setFunctionSearch(e.target.value)}
                className="mb-2"
              />
              {Object.entries(groupedFunctions).map(([category, fns]) => (
                <div key={category} className="mb-2">
                  <div className="text-xs font-medium text-[var(--color-muted-foreground)] mb-1 px-1 capitalize">{category}</div>
                  <div className="grid grid-cols-2 gap-1">
                    {fns.map(fn => (
                      <Button
                        key={fn.name}
                        variant="ghost"
                        size="sm"
                        className="h-auto p-2 text-left justify-start gap-1"
                        onClick={() => {
                          const args = fn.args.map(a => `<${a.name}>`).join(', ');
                          setFormulaBar(`=${fn.name}(${args})`);
                          setShowFunctionPicker(false);
                          if (selectedCell) evaluateCell(activeSheet, selectedCell, `=${fn.name}(${args})`);
                        }}
                      >
                        <span className="font-mono text-sm">{fn.name}</span>
                        <span className="text-xs text-[var(--color-muted-foreground)]">{fn.description}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setShowFunctionPicker(false)}>
                Close
              </Button>
            </div>
          )}
        </div>

        <Input
          placeholder="Search tax functions..."
          value={functionSearch}
          onChange={e => setFunctionSearch(e.target.value)}
          className="w-64 hidden sm:block"
        />

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleSave} disabled={isCalculating}>
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={handlePdfExport}>
            <FileText className="h-3.5 w-3.5" />
            PDF
          </Button>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <Upload className="h-3.5 w-3.5" />
            <span className="text-sm">Import</span>
            <input type="file" accept=".csv" onChange={handleImport} className="sr-only" />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-card)]">
        <span className="font-mono text-xs text-[var(--color-muted-foreground)] shrink-0">fx</span>
        <input
          className="h-7 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50"
          value={formulaBar}
          placeholder={selectedCell ? `${selectedCell}: enter a value or =formula` : 'Select a cell to edit'}
          onChange={e => setFormulaBar(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && selectedCell) handleCellChange(selectedCell, formulaBar);
            if (e.key === 'Escape') {
              const cell = sheets.get(activeSheet)?.cells.get(selectedCell ?? '');
              setFormulaBar(cell?.formula || cell?.value || '');
            }
          }}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-card)] overflow-x-auto">
          {Array.from(sheets.keys()).map(name => (
            <button
              key={name}
              onClick={() => setActiveSheet(name)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors whitespace-nowrap',
                activeSheet === name
                  ? 'bg-[var(--color-background)] text-[var(--color-foreground)] border-b-2 border-[var(--color-primary)]'
                  : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]'
              )}
            >
              {name}
            </button>
          ))}
          <Button variant="ghost" size="sm" className="ml-1" onClick={() => {
            const newName = `Sheet${sheets.size + 1}`;
            hfRef.current?.addSheet(newName);
            setSheets(prev => {
              const newSheets = new Map(prev);
              newSheets.set(newName, { name: newName, cells: new Map(), rows: DEFAULT_ROWS, cols: DEFAULT_COLS });
              return newSheets;
            });
            setActiveSheet(newName);
          }}>
            +
          </Button>
        </div>

        <div className="flex-1 overflow-auto relative">
          <div className="min-w-[1500px] grid grid-cols-[32px_repeat(26,minmax(80px,1fr))]">
            <div className="sticky left-0 z-10 bg-[var(--color-card)] border-r border-[var(--color-border)]" />
            {COLUMN_LABELS.map(col => (
              <div key={col} className="sticky top-0 z-10 h-8 border-b border-r border-[var(--color-border)] bg-[var(--color-card)] flex items-center justify-center font-mono text-xs font-medium text-[var(--color-muted-foreground)]">
                {col}
              </div>
            ))}
            {Array.from({ length: DEFAULT_ROWS }, (_, r) => (
              <Fragment key={r}>
                <div className="sticky left-0 z-10 w-8 h-8 border-b border-r border-[var(--color-border)] bg-[var(--color-card)] flex items-center justify-center font-mono text-xs text-[var(--color-muted-foreground)]">
                  {r + 1}
                </div>
                {COLUMN_LABELS.map((_, c) => {
                  const key = cellKey(r, c);
                  const cell = sheets.get(activeSheet)?.cells.get(key);
                  const isSelected = selectedCell === key;
                  const hasError = errors.has(key);
                  const isFormula = cell?.isFormula;

                  return (
                    <div
                      key={key}
                      className={cn(
                        'relative h-8 border-b border-r border-[var(--color-border)] bg-[var(--color-background)] cursor-cell',
                        isSelected && 'ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-background)]',
                        hasError && 'border-red-500',
                        isFormula && 'bg-blue-50/50'
                      )}
                      onClick={() => handleCellSelect(key)}
                      onDoubleClick={() => {
                        const cellData = sheets.get(activeSheet)?.cells.get(key);
                        setFormulaBar(cellData?.formula || cellData?.value || '');
                        setSelectedCell(key);
                      }}
                    >
                      {isFormula ? (
                        <span className="text-xs text-blue-600 font-mono truncate block px-1">{cell?.formula}</span>
                      ) : (
                        <span className="truncate block px-1 align-middle">{cell?.value || ''}</span>
                      )}
                      {hasError && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-red-500" />
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-card)] text-xs text-[var(--color-muted-foreground)]">
          <div className="flex items-center gap-4">
            <span>Ready</span>
            {isCalculating && <span className="flex items-center gap-1 text-blue-600"><RefreshCw className="h-3 w-3 animate-spin" />Calculating...</span>}
            {errors.size > 0 && <span className="text-red-600">{errors.size} error(s)</span>}
            {lastSaved && <span>Last saved: {lastSaved.toLocaleTimeString()}</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono">{selectedCell || 'No cell selected'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TaxWorkpaper;