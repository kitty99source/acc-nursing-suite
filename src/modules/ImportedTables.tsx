import { useStore } from '../state/store';
import { SectionTitle, Card, EmptyState } from '../components/ui';
import { IconFolder } from '../components/icons';

// Renders any generic tables absorbed from unrecognised Excel sheets during
// import (AppData.customSheets). Only surfaced in navigation when non-empty.
export function ImportedTables() {
  const customSheets = useStore((s) => s.data.customSheets ?? []);

  return (
    <div>
      <SectionTitle
        title="Imported Tables"
        subtitle="Extra worksheets absorbed from an Excel import that aren't part of the core schema. Preserved verbatim and re-exported on your next Excel download."
      />

      {customSheets.length === 0 ? (
        <EmptyState
          icon={<IconFolder width={32} height={32} />}
          title="No imported tables"
          message="When you import an Excel file that contains sheets outside the standard set, they appear here as generic tables."
        />
      ) : (
        <div className="space-y-5">
          {customSheets.map((sheet) => (
            <Card key={sheet.name}>
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <h3 className="font-semibold">{sheet.name}</h3>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {sheet.rows.length} row{sheet.rows.length === 1 ? '' : 's'} · {sheet.headers.length} column
                  {sheet.headers.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="overflow-auto" style={{ maxHeight: '55vh' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      {sheet.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.rows.map((row, i) => (
                      <tr key={i}>
                        {sheet.headers.map((h) => (
                          <td key={h}>{row[h] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
