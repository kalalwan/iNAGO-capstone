'use client';

import { GroupFairnessMetrics, UserSatisfactionResult, SessionUser } from '@/lib/types';
import { Scale, TrendingUp, Users, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FairnessMetricsCardProps {
  metrics: GroupFairnessMetrics;
  userSatisfaction: UserSatisfactionResult[];
  users?: SessionUser[];
}

export default function FairnessMetricsCard({ metrics, userSatisfaction, users }: FairnessMetricsCardProps) {
  const getUserColor = (userId: string): string | undefined => {
    return users?.find(u => u.id === userId)?.color;
  };

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-4 rounded-xl border border-indigo-100 mb-4">
      <h4 className="font-semibold text-sm text-indigo-800 mb-3 flex items-center gap-2">
        <Scale size={16} />
        Fairness Analysis (Pareto + Nash)
      </h4>

      {/* Nash Welfare - Primary Metric */}
      <div className="bg-white/80 rounded-lg p-3 mb-3 border border-indigo-200">
        <div className="text-xs text-indigo-600 font-medium">Nash Welfare (Selection Criterion)</div>
        <div className="text-2xl font-bold text-indigo-700">
          {(metrics.nash * 100).toFixed(0)}%
        </div>
        <div className="text-[10px] text-gray-500 mt-1">
          Geometric mean of satisfaction scores
        </div>
      </div>

      {/* Secondary Metrics Grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-white/60 rounded-lg p-2">
          <div className="text-[10px] text-gray-500 flex items-center gap-1">
            <TrendingUp size={10} />
            Average
          </div>
          <div className="text-sm font-bold text-gray-700">
            {(metrics.utilitarian * 100).toFixed(0)}%
          </div>
        </div>
        <div className="bg-white/60 rounded-lg p-2">
          <div className="text-[10px] text-gray-500 flex items-center gap-1">
            <Users size={10} />
            Minimum
          </div>
          <div className="text-sm font-bold text-gray-700">
            {(metrics.egalitarian * 100).toFixed(0)}%
          </div>
        </div>
        <div className="bg-white/60 rounded-lg p-2">
          <div className="text-[10px] text-gray-500">Gini</div>
          <div className={cn(
            "text-sm font-bold",
            metrics.gini < 0.2 ? "text-green-600" :
            metrics.gini < 0.4 ? "text-yellow-600" : "text-red-600"
          )}>
            {(metrics.gini * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Per-user satisfaction */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-gray-600">Per-Person Satisfaction</div>
        {userSatisfaction.map(u => {
          const color = getUserColor(u.userId);
          return (
            <div key={u.userId} className="flex items-center gap-2">
              {color && (
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              )}
              <span className="text-xs w-16 truncate">{u.userName}</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    u.satisfied ? (
                      u.score > 0.7 ? "bg-green-500" :
                      u.score > 0.4 ? "bg-yellow-500" : "bg-orange-500"
                    ) : "bg-red-500"
                  )}
                  style={{ width: `${u.score * 100}%` }}
                />
              </div>
              <span className={cn(
                "text-xs font-mono w-10",
                u.satisfied ? "text-gray-600" : "text-red-600"
              )}>
                {(u.score * 100).toFixed(0)}%
              </span>
              {!u.satisfied && (
                <AlertCircle size={12} className="text-red-500" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
