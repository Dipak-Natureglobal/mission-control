// Generic wizard chrome: back arrow + step counter + progress bar, then
// renders whatever screen <children/> are passed in. Workflow content
// lives in the views; this file owns chrome only.
//
// Wave 15c-fu: lifted to blinker-platform/components/ from
// refi-portal/src/shared/WizardShell.jsx (chosen for its `Footer` alias
// + eyebrow default, both strict supersets of the protection / insurance
// copies). mission-control's variant was unused dead code and is
// discarded as part of the sweep.
import { ArrowLeft, ArrowRight } from 'lucide-react';

export function WizardShell({ children, progress = 0, stepIndex = 1, stepTotal = 1, onBack }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 pt-5 pb-3">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onBack}
            disabled={!onBack}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
          <div className="text-xs text-slate-500">
            Step {stepIndex} of {stepTotal}
          </div>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: progress + '%' }}
          />
        </div>
      </div>
      {children}
    </div>
  );
}

// Eyebrow + title + subtitle. Default eyebrow is the refi-prototype's
// "Pre Qualification for a Loan" so screens lifted from there don't have
// to specify it explicitly.
export function ScreenHeader({ icon: Icon, eyebrow = 'Pre Qualification for a Loan', title, subtitle }) {
  return (
    <div className="px-6 pt-2 pb-4">
      {(Icon || eyebrow) && (
        <div className="flex items-center gap-2 text-blue-600 mb-2">
          {Icon && <Icon className="w-4 h-4" />}
          {eyebrow && (
            <span className="text-xs uppercase tracking-wide font-semibold">{eyebrow}</span>
          )}
        </div>
      )}
      {title && <h2 className="text-xl font-semibold tracking-tight">{title}</h2>}
      {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

// Footer with optional secondary slot on the left and a primary Next on
// the right. Refi prototype calls this `Footer`; we keep both names so
// lifted screens can use either.
export function WizardFooter({ onNext, disabled, nextLabel = 'Next', secondary }) {
  return (
    <div className="px-6 pb-5 pt-4 flex items-center justify-between border-t border-slate-100 mt-4">
      {secondary}
      <button
        onClick={onNext}
        disabled={disabled}
        className={
          'px-5 py-2 rounded-md font-semibold text-sm flex items-center gap-2 ml-auto ' +
          (disabled
            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white')
        }
      >
        {nextLabel} <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// Alias — refi-prototype screens use the bare `Footer` name.
export { WizardFooter as Footer };
