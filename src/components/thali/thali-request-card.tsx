'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type PortionOption = { id: string; label: string };

export type ExistingRequest = {
  wantsThali: boolean;
  rotiQuantity: number | null;
  gravyPortionId: string | null;
  ricePortionId: string | null;
  gravyLabel: string | null;
  riceLabel: string | null;
  updatedAt: string;
} | null;

type Step = 'view' | 'choice' | 'portions' | 'confirm-no';

export function ThaliRequestCard({
  serviceDate,
  serviceDateLabel,
  cutoffPassed,
  existingRequest,
  gravyOptions,
  riceOptions,
  rotiMin,
  rotiMax,
  cutoffTime,
  action,
}: {
  serviceDate: string;
  serviceDateLabel: string;
  cutoffPassed: boolean;
  existingRequest: ExistingRequest;
  gravyOptions: PortionOption[];
  riceOptions: PortionOption[];
  rotiMin: number;
  rotiMax: number;
  cutoffTime: string;
  action: (formData: FormData) => void;
}) {
  const [step, setStep] = useState<Step>(existingRequest ? 'view' : 'choice');
  const [gravyPortionId, setGravyPortionId] = useState(
    gravyOptions.some((o) => o.id === existingRequest?.gravyPortionId) ? existingRequest!.gravyPortionId! : ''
  );
  const [ricePortionId, setRicePortionId] = useState(
    riceOptions.some((o) => o.id === existingRequest?.ricePortionId) ? existingRequest!.ricePortionId! : ''
  );
  const [rotiQuantity, setRotiQuantity] = useState(existingRequest?.rotiQuantity ?? rotiMin);

  if (cutoffPassed) {
    return (
      <div className="rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 text-xl font-semibold text-gray-700">
          <Lock className="size-6" />
          Request Closed
        </div>
        <p className="mt-2 text-lg text-gray-600">{serviceDateLabel}&apos;s thali selection closed at {cutoffTime}.</p>
        {existingRequest ? (
          existingRequest.wantsThali ? (
            <div className="mt-4 space-y-1 text-lg">
              <p className="font-semibold text-green-700">Thali Requested</p>
              <p>Gravy: {existingRequest.gravyLabel}</p>
              <p>Rice: {existingRequest.riceLabel}</p>
              <p>Roti: {existingRequest.rotiQuantity}</p>
            </div>
          ) : (
            <p className="mt-4 text-lg font-semibold text-gray-700">No Thali Requested</p>
          )
        ) : (
          <p className="mt-4 text-lg font-semibold text-gray-700">No Response Submitted Before Cutoff</p>
        )}
      </div>
    );
  }

  if (step === 'view' && existingRequest) {
    return (
      <div className="rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 text-xl font-semibold text-green-700">
          <CheckCircle2 className="size-6" />
          {existingRequest.wantsThali ? 'Confirmed' : 'No Thali'}
        </div>
        {existingRequest.wantsThali && (
          <div className="mt-4 space-y-1 text-lg">
            <p>Gravy: {existingRequest.gravyLabel}</p>
            <p>Rice: {existingRequest.riceLabel}</p>
            <p>Roti: {existingRequest.rotiQuantity}</p>
          </div>
        )}
        <p className="mt-4 text-lg text-gray-600">You can change your selection until {cutoffTime} today.</p>
        <Button type="button" className="mt-4 h-14 w-full text-xl" onClick={() => setStep('choice')}>
          Change Selection
        </Button>
      </div>
    );
  }

  if (step === 'confirm-no') {
    return (
      <div className="rounded-xl border border-gray-200 p-6">
        <p className="text-xl font-semibold">No thali for {serviceDateLabel}?</p>
        <form action={action} className="mt-4">
          <input type="hidden" name="serviceDate" value={serviceDate} />
          <input type="hidden" name="wantsThali" value="false" />
          <Button type="submit" variant="destructive" className="h-14 w-full text-xl">
            <XCircle className="size-6" />
            Yes, Confirm No Thali
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          className="mt-3 h-14 w-full text-xl"
          onClick={() => setStep(existingRequest ? 'view' : 'choice')}
        >
          Go Back
        </Button>
      </div>
    );
  }

  if (step === 'portions') {
    return (
      <form action={action} className="rounded-xl border border-gray-200 p-6">
        <input type="hidden" name="serviceDate" value={serviceDate} />
        <input type="hidden" name="wantsThali" value="true" />
        <p className="text-xl font-semibold">Do you need a Thali {serviceDateLabel}?</p>

        <div className="mt-4">
          <p className="text-lg font-semibold">Gravy</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Gravy">
            {gravyOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setGravyPortionId(opt.id)}
                aria-pressed={gravyPortionId === opt.id}
                className={`flex h-12 items-center gap-1.5 rounded-lg border px-4 text-lg ${
                  gravyPortionId === opt.id ? 'border-blue-600 bg-blue-50 font-semibold' : 'border-gray-300'
                }`}
              >
                {gravyPortionId === opt.id && <CheckCircle2 className="size-4" />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <input type="hidden" name="gravyPortionId" value={gravyPortionId} />

        <div className="mt-4">
          <p className="text-lg font-semibold">Rice</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Rice">
            {riceOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setRicePortionId(opt.id)}
                aria-pressed={ricePortionId === opt.id}
                className={`flex h-12 items-center gap-1.5 rounded-lg border px-4 text-lg ${
                  ricePortionId === opt.id ? 'border-blue-600 bg-blue-50 font-semibold' : 'border-gray-300'
                }`}
              >
                {ricePortionId === opt.id && <CheckCircle2 className="size-4" />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <input type="hidden" name="ricePortionId" value={ricePortionId} />

        <div className="mt-4">
          <p className="text-lg font-semibold">Roti</p>
          <div className="mt-2 flex items-center gap-4">
            <button
              type="button"
              aria-label="Decrease roti quantity"
              onClick={() => setRotiQuantity((q) => Math.max(rotiMin, q - 1))}
              className="h-12 w-12 rounded-lg border border-gray-300 text-xl"
            >
              −
            </button>
            <span className="w-8 text-center text-xl font-semibold" aria-live="polite">{rotiQuantity}</span>
            <button
              type="button"
              aria-label="Increase roti quantity"
              onClick={() => setRotiQuantity((q) => Math.min(rotiMax, q + 1))}
              className="h-12 w-12 rounded-lg border border-gray-300 text-xl"
            >
              +
            </button>
          </div>
        </div>
        <input type="hidden" name="rotiQuantity" value={rotiQuantity} />

        <Button type="submit" disabled={!gravyPortionId || !ricePortionId} className="mt-6 h-14 w-full text-xl">
          Confirm Thali
        </Button>
      </form>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 p-6">
      <p className="text-xl font-semibold">Do you need a Thali {serviceDateLabel}?</p>
      <div className="mt-4 space-y-3">
        <Button type="button" className="h-14 w-full text-xl" onClick={() => setStep('portions')}>
          <CheckCircle2 className="size-6" />
          Yes, I Need Thali
        </Button>
        <Button type="button" variant="outline" className="h-14 w-full text-xl" onClick={() => setStep('confirm-no')}>
          <XCircle className="size-6" />
          No Thali
        </Button>
      </div>
    </div>
  );
}
