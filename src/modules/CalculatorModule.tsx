import { useMemo, useState } from 'react';
import { Card, Field, DateInput, NumberInput, SectionTitle, Badge } from '../components/ui';
import { IconPlus, IconTrash } from '../components/icons';
import {
  determinePackage,
  reclassifySubsequentInjury,
  ns06Watch,
  type PackageInput,
} from '../lib/calculator';
import type { Interruption, ServiceCode } from '../types';
import { useStore } from '../state/store';
import { formatCurrency, serviceCodeLabel, getRate, SERVICE_CODES } from '../lib/serviceCodes';

export function PackageCalculatorPanel({
  initial,
  onApply,
}: {
  initial?: Partial<PackageInput>;
  onApply?: (recommended: string, value: number) => void;
}) {
  const rates = useStore((s) => s.data.settings.serviceRates);
  const [day1, setDay1] = useState(initial?.day1 ?? '');
  const [ongoing, setOngoing] = useState(false);
  const [lastConsult, setLastConsult] = useState(initial?.lastConsult ?? '');
  const [consultCount, setConsultCount] = useState<number>(initial?.consultCount ?? 0);
  const [interruptions, setInterruptions] = useState<Interruption[]>(initial?.interruptions ?? []);

  const determination = useMemo(() => {
    if (!day1) return null;
    return determinePackage(
      {
        day1,
        lastConsult: ongoing ? undefined : lastConsult || undefined,
        consultCount,
        interruptions,
      },
      rates,
    );
  }, [day1, ongoing, lastConsult, consultCount, interruptions, rates]);

  function addInterruption() {
    setInterruptions((prev) => [...prev, { start: '', end: '' }]);
  }
  function updateInterruption(idx: number, patch: Partial<Interruption>) {
    setInterruptions((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeInterruption(idx: number) {
    setInterruptions((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <h3 className="font-semibold mb-3">Inputs</h3>
        <div className="space-y-3">
          <Field label="Day 1 (start of package)" required>
            <DateInput value={day1} onChange={(e) => setDay1(e.target.value)} />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ongoing}
              onChange={(e) => setOngoing(e.target.checked)}
            />
            Episode is ongoing (no last-consult date yet)
          </label>

          {!ongoing && (
            <Field label="Last consult date">
              <DateInput value={lastConsult} onChange={(e) => setLastConsult(e.target.value)} />
            </Field>
          )}

          <Field label="Number of consults logged">
            <NumberInput
              min={0}
              value={consultCount}
              onChange={(e) => setConsultCount(Math.max(0, Number(e.target.value)))}
            />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="label mb-0">Interruptions (days still counted in span)</span>
              <button className="btn btn-sm" onClick={addInterruption}>
                <IconPlus width={14} height={14} /> Add
              </button>
            </div>
            {interruptions.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                None recorded.
              </p>
            )}
            <div className="space-y-2">
              {interruptions.map((it, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <DateInput
                    value={it.start}
                    onChange={(e) => updateInterruption(idx, { start: e.target.value })}
                  />
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    to
                  </span>
                  <DateInput
                    value={it.end}
                    onChange={(e) => updateInterruption(idx, { end: e.target.value })}
                  />
                  <button
                    className="btn btn-icon btn-icon-danger"
                    onClick={() => removeInterruption(idx)}
                    aria-label="Remove interruption"
                  >
                    <IconTrash width={14} height={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-3">Recommendation</h3>
        {!determination ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Enter a Day 1 date to see the recommended package.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {determination.recommendedCodes.map((c) => (
                <Badge key={c} tone="accent">
                  {c}
                </Badge>
              ))}
              {determination.requiresApproval && <Badge tone="salmon">ACC approval required</Badge>}
              {determination.ongoing && <Badge tone="warn">Ongoing</Badge>}
            </div>

            <div className="text-3xl font-bold" style={{ color: 'var(--accent)' }}>
              {formatCurrency(determination.totalValue)}
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Package {formatCurrency(determination.packageValue)}
              {determination.extendedValue != null && determination.extendedValue > 0 && (
                <> + NS04 {formatCurrency(determination.extendedValue)}</>
              )}{' '}
              · excl GST
            </div>

            <div className="text-sm rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
              {determination.reason}
            </div>

            {determination.interruptionNote && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {determination.interruptionNote}
              </p>
            )}

            <p className="text-xs font-medium" style={{ color: 'var(--warn-fg)' }}>
              {determination.reminder}
            </p>

            <div className="text-xs grid grid-cols-2 gap-2" style={{ color: 'var(--muted)' }}>
              <div>Duration: {determination.durationDays} day(s)</div>
              <div>Consults: {determination.consultCount}</div>
              {determination.extendedConsults != null && (
                <div>Est. NS04 consults: {determination.extendedConsults}</div>
              )}
            </div>

            {onApply && (
              <button
                className="btn btn-primary w-full"
                onClick={() =>
                  onApply(determination.recommendedCodes.join(' + '), determination.totalValue)
                }
              >
                Apply recommendation
              </button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function SubsequentInjuryTool() {
  const rates = useStore((s) => s.data.settings.serviceRates);
  const [reassessmentDate, setReassessmentDate] = useState('');
  const [lastConsult, setLastConsult] = useState('');
  const [consultCount, setConsultCount] = useState(0);

  const result = useMemo(() => {
    if (!reassessmentDate) return null;
    return reclassifySubsequentInjury(
      {
        reassessmentDate,
        lastConsult: lastConsult || undefined,
        consultCount,
      },
      rates,
    );
  }, [reassessmentDate, lastConsult, consultCount, rates]);

  return (
    <Card>
      <h3 className="font-semibold mb-1">Subsequent injury → new primary injury</h3>
      <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
        When the original injury is resolved, the subsequent injury becomes the new primary. Its new
        Day 1 is the reassessment date (not backdated).
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Reassessment date (new Day 1)" required>
          <DateInput value={reassessmentDate} onChange={(e) => setReassessmentDate(e.target.value)} />
        </Field>
        <Field label="Last consult (optional)">
          <DateInput value={lastConsult} onChange={(e) => setLastConsult(e.target.value)} />
        </Field>
        <Field label="Consults since reassessment">
          <NumberInput
            min={0}
            value={consultCount}
            onChange={(e) => setConsultCount(Math.max(0, Number(e.target.value)))}
          />
        </Field>
      </div>
      {result && (
        <div className="mt-3 text-sm rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
          <div className="flex items-center gap-2 mb-1">
            {result.recommendedCodes.map((c) => (
              <Badge key={c} tone="accent">
                {c}
              </Badge>
            ))}
            <span className="font-semibold">{formatCurrency(result.totalValue)}</span>
          </div>
          <div>{result.reason}</div>
          <div className="text-xs mt-2" style={{ color: 'var(--warn-fg)' }}>
            {result.note}
          </div>
        </div>
      )}
    </Card>
  );
}

function NS06WatchTool() {
  const [count, setCount] = useState(0);
  const watch = ns06Watch(count);
  return (
    <Card>
      <h3 className="font-semibold mb-1">NS06 treatment watch</h3>
      <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
        NS06 needs notification (ACC179), not approval — unless more than 50 treatments on the same
        claim. Flags at 45.
      </p>
      <div className="flex items-end gap-3">
        <Field label="NS06 treatments on this claim">
          <NumberInput
            min={0}
            value={count}
            onChange={(e) => setCount(Math.max(0, Number(e.target.value)))}
          />
        </Field>
        <div className="pb-2">
          {watch.exceeded ? (
            <Badge tone="danger">Approval required</Badge>
          ) : watch.approaching ? (
            <Badge tone="salmon">Approaching limit</Badge>
          ) : (
            <Badge tone="good">OK</Badge>
          )}
        </div>
      </div>
      <p className="text-sm mt-2">{watch.message}</p>
    </Card>
  );
}

const RATE_REFERENCE_BASIS: Partial<Record<ServiceCode, string>> = {
  NS01: 'package · 1–13 days · min 1 consult',
  NS02: 'package · 14–42 days · min 6 consults',
  NS03: 'package · 43–105 days · min 12 consults',
  NS04: 'per consult · approval required',
  NS05: 'per HOUR · approval required',
  NS06: 'per consult · notify (ACC179)',
  NS07: 'per consult · first per claim no approval',
  NS20: 'comprehensive assessment',
};

function RateReference() {
  const settings = useStore((s) => s.data.settings);
  const codes = Object.keys(RATE_REFERENCE_BASIS) as ServiceCode[];
  return (
    <Card>
      <h3 className="font-semibold mb-3">Rate reference (excl GST)</h3>
      <div className="space-y-1.5 text-sm">
        {codes.map((code) => (
          <div key={code} className="flex items-center justify-between gap-3">
            <span className="truncate">
              {serviceCodeLabel(code)}
              <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                {RATE_REFERENCE_BASIS[code]}
              </span>
            </span>
            <span className="shrink-0 font-semibold">
              {SERVICE_CODES[code].basis === 'actual'
                ? 'actual cost'
                : formatCurrency(getRate(code, settings))}
            </span>
          </div>
        ))}
        <p className="text-xs pt-2" style={{ color: 'var(--muted)' }}>
          Rates come from your editable contract pricing (Settings → Contract pricing). All packages
          cap at 25 consults — consults 26+ bill as NS04. Travel (NSTD10/NSTT1/NSTT1D/NSAC) only with
          NS05/NS07/NS20.
        </p>
      </div>
    </Card>
  );
}

export function CalculatorModule() {
  return (
    <div>
      <SectionTitle
        title="Package Calculator"
        subtitle="Determine the correct package of care from duration, consults and interruptions."
      />
      <div className="space-y-4">
        <PackageCalculatorPanel />
        <div className="grid lg:grid-cols-2 gap-4">
          <SubsequentInjuryTool />
          <NS06WatchTool />
        </div>
        <RateReference />
      </div>
    </div>
  );
}
