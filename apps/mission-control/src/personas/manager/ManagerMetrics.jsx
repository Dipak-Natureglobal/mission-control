import { BarChart3 } from 'lucide-react';

// Wave 28a scaffold. Wave 28f embeds Looker boards per ADR 16 +
// manager-scoped entries in canon/integrations.json.
export function ManagerMetrics() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-center gap-2 text-emerald-600 mb-2">
          <BarChart3 className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">Manager · Metrics</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-1">Metrics</h1>
        <p className="text-sm text-slate-500 mb-6">
          Team performance dashboards.
        </p>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-sm text-slate-500">
          Looker boards will embed here. Wave 28f.
        </div>
      </div>
    </div>
  );
}
