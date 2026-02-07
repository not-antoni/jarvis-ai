import {
    Brain,
    Clock,
    Heart,
    RefreshCw,
    Sparkles,
    Target,
    Zap
} from 'lucide-react';
import { useEffect, useState } from 'react';

function TraitBar({ label, value, icon, color }) {
    return (
        <div className="flex items-center gap-3">
            <span className="text-sm w-20 text-[#858585]">{icon} {label}</span>
            <div className="flex-1 h-2 bg-[#2d2d2d] rounded-full overflow-hidden">
                <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${value}%`, backgroundColor: color }}
                />
            </div>
            <span className="text-xs text-[#cccccc] w-8 text-right">{value}%</span>
        </div>
    );
}

export default function Soul() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const res = await fetch('/api/dashboard/soul');
            if (res.ok) {
                setData(await res.json());
            }
        } catch (err) {
            console.error('Failed to fetch soul data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 15000);
        return () => clearInterval(interval);
    }, []);

    const soul = data?.soul;
    const agent = data?.agent;
    const agis = data?.agis;

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl font-semibold text-[#cccccc]">Soul & Sentience</h1>
                    <p className="text-sm text-[#858585]">Artificial personality, agent status, and A.G.I.S.</p>
                </div>
                <button
                    onClick={fetchData}
                    className="p-2 rounded bg-[#2d2d2d] hover:bg-[#3c3c3c] transition-colors"
                >
                    <RefreshCw className={`w-4 h-4 text-[#858585] ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Soul Traits */}
                <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Heart className="w-5 h-5 text-[#e91e63]" />
                        <h2 className="text-sm font-medium text-[#cccccc]">Artificial Soul</h2>
                        {soul?.mood && (
                            <span className="ml-auto px-2 py-0.5 text-xs rounded bg-[#2d2d2d] text-[#9cdcfe]">
                                {soul.mood}
                            </span>
                        )}
                    </div>
                    {soul?.traits ? (
                        <div className="space-y-3">
                            <TraitBar label="Sass" value={soul.traits.sass} icon="💢" color="#f14c4c" />
                            <TraitBar label="Empathy" value={soul.traits.empathy} icon="💜" color="#b388ff" />
                            <TraitBar label="Curiosity" value={soul.traits.curiosity} icon="🔍" color="#9cdcfe" />
                            <TraitBar label="Humor" value={soul.traits.humor} icon="😂" color="#dcdcaa" />
                            <TraitBar label="Wisdom" value={soul.traits.wisdom} icon="🧠" color="#4ec9b0" />
                            <TraitBar label="Chaos" value={soul.traits.chaos} icon="🎭" color="#f48771" />
                            <TraitBar label="Loyalty" value={soul.traits.loyalty} icon="🛡" color="#0078d4" />
                            <TraitBar label="Creativity" value={soul.traits.creativity} icon="💡" color="#ce9178" />
                        </div>
                    ) : (
                        <p className="text-sm text-[#6e6e6e]">Soul data unavailable</p>
                    )}
                    {soul?.age && (
                        <div className="mt-4 flex items-center gap-2 text-xs text-[#6e6e6e]">
                            <Clock className="w-3 h-3" />
                            Soul age: {soul.age}
                        </div>
                    )}
                    {soul?.evolutionCount > 0 && (
                        <div className="mt-1 text-xs text-[#6e6e6e]">
                            {soul.evolutionCount} evolutions recorded
                        </div>
                    )}
                </div>

                {/* Sentient Agent */}
                <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Brain className="w-5 h-5 text-[#9cdcfe]" />
                        <h2 className="text-sm font-medium text-[#cccccc]">Sentient Agent</h2>
                        {agent?.state && (
                            <span className={`ml-auto px-2 py-0.5 text-xs rounded ${
                                agent.state === 'ready'
                                    ? 'bg-[#1e3a29] text-[#4ec9b0]'
                                    : 'bg-[#3a2a1e] text-[#dcdcaa]'
                            }`}>
                                {agent.state}
                            </span>
                        )}
                    </div>
                    {agent ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 rounded bg-[#2d2d2d]">
                                    <p className="text-lg font-semibold text-[#cccccc]">{agent.memory?.shortTerm || 0}</p>
                                    <p className="text-xs text-[#858585]">Short-term memories</p>
                                </div>
                                <div className="p-3 rounded bg-[#2d2d2d]">
                                    <p className="text-lg font-semibold text-[#cccccc]">{agent.memory?.learnings || 0}</p>
                                    <p className="text-xs text-[#858585]">Learnings</p>
                                </div>
                                <div className="p-3 rounded bg-[#2d2d2d]">
                                    <p className="text-lg font-semibold text-[#cccccc]">{agent.memory?.goals || 0}</p>
                                    <p className="text-xs text-[#858585]">Active goals</p>
                                </div>
                                <div className="p-3 rounded bg-[#2d2d2d]">
                                    <p className="text-lg font-semibold text-[#cccccc]">
                                        {agent.autonomousMode ? 'ON' : 'OFF'}
                                    </p>
                                    <p className="text-xs text-[#858585]">Autonomous mode</p>
                                </div>
                            </div>
                            <div className="text-xs text-[#6e6e6e]">
                                ID: {agent.id} | Capabilities: {agent.capabilities?.length || 0}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-[#6e6e6e]">Sentient agent not initialized</p>
                    )}
                </div>

                {/* A.G.I.S. */}
                <div className="lg:col-span-2 bg-[#252526] border border-[#3c3c3c] rounded-lg p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Target className="w-5 h-5 text-[#00bcf2]" />
                        <h2 className="text-sm font-medium text-[#cccccc]">A.G.I.S. — Artificial General Intelligent System</h2>
                        {agis && (
                            <span className={`ml-auto px-2 py-0.5 text-xs rounded ${
                                agis.enabled
                                    ? 'bg-[#1e3a29] text-[#4ec9b0]'
                                    : 'bg-[#3a1e1e] text-[#f14c4c]'
                            }`}>
                                {agis.enabled ? 'Online' : 'Offline'}
                            </span>
                        )}
                    </div>
                    {agis ? (
                        <div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                <div className="p-3 rounded bg-[#2d2d2d]">
                                    <p className="text-lg font-semibold text-[#0078d4]">{agis.activeGoals}</p>
                                    <p className="text-xs text-[#858585]">Active Goals</p>
                                </div>
                                <div className="p-3 rounded bg-[#2d2d2d]">
                                    <p className="text-lg font-semibold text-[#4ec9b0]">{agis.activePlans}</p>
                                    <p className="text-xs text-[#858585]">Active Plans</p>
                                </div>
                                <div className="p-3 rounded bg-[#2d2d2d]">
                                    <p className="text-lg font-semibold text-[#dcdcaa]">{agis.completedPlans}</p>
                                    <p className="text-xs text-[#858585]">Completed Plans</p>
                                </div>
                                <div className="p-3 rounded bg-[#2d2d2d]">
                                    <p className="text-lg font-semibold text-[#9cdcfe]">{agis.uptime}s</p>
                                    <p className="text-xs text-[#858585]">Uptime</p>
                                </div>
                            </div>
                            {agis.context?.capabilities?.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {agis.context.capabilities.map((cap, i) => (
                                        <span key={i} className="px-2 py-1 text-xs rounded bg-[#2d2d2d] text-[#858585]">
                                            <Sparkles className="w-3 h-3 inline mr-1" />
                                            {cap.name || cap}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 p-4 rounded bg-[#2d2d2d]">
                            <Zap className="w-5 h-5 text-[#6e6e6e]" />
                            <p className="text-sm text-[#6e6e6e]">A.G.I.S. requires selfhost mode</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
