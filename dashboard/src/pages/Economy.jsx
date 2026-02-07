import {
    Coins,
    Crown,
    RefreshCw,
    TrendingUp,
    Users
} from 'lucide-react';
import { useEffect, useState } from 'react';

export default function Economy() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const res = await fetch('/api/dashboard/economy');
            if (res.ok) {
                setData(await res.json());
            }
        } catch (err) {
            console.error('Failed to fetch economy data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl font-semibold text-[#cccccc]">Stark Economy</h1>
                    <p className="text-sm text-[#858585]">Stark Bucks virtual economy overview</p>
                </div>
                <button
                    onClick={fetchData}
                    className="p-2 rounded bg-[#2d2d2d] hover:bg-[#3c3c3c] transition-colors"
                >
                    <RefreshCw className={`w-4 h-4 text-[#858585] ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#dcdcaa] to-[#c4b466] flex items-center justify-center">
                            <Users className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <p className="text-2xl font-semibold text-[#cccccc]">
                                {data?.totalUsers?.toLocaleString() || '0'}
                            </p>
                            <p className="text-xs text-[#858585]">Total Users</p>
                        </div>
                    </div>
                </div>
                <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#4ec9b0] to-[#3da88a] flex items-center justify-center">
                            <Coins className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <p className="text-2xl font-semibold text-[#cccccc]">
                                {data?.totalBucks?.toLocaleString() || '0'}
                            </p>
                            <p className="text-xs text-[#858585]">Total Stark Bucks in Circulation</p>
                        </div>
                    </div>
                </div>
                <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#0078d4] to-[#00bcf2] flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <p className="text-2xl font-semibold text-[#cccccc]">
                                {data?.totalUsers > 0
                                    ? Math.round((data?.totalBucks || 0) / data.totalUsers).toLocaleString()
                                    : '0'}
                            </p>
                            <p className="text-xs text-[#858585]">Avg Balance per User</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Leaderboard */}
            <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-5">
                <div className="flex items-center gap-2 mb-4">
                    <Crown className="w-5 h-5 text-[#dcdcaa]" />
                    <h2 className="text-sm font-medium text-[#cccccc]">Top 10 Richest Users</h2>
                </div>
                {data?.topUsers?.length > 0 ? (
                    <div className="space-y-2">
                        {data.topUsers.map((user, i) => (
                            <div
                                key={i}
                                className="flex items-center gap-3 p-3 rounded bg-[#2d2d2d] card-hover"
                            >
                                <span className={`w-6 text-center font-semibold text-sm ${
                                    i === 0 ? 'text-[#dcdcaa]' :
                                    i === 1 ? 'text-[#cccccc]' :
                                    i === 2 ? 'text-[#ce9178]' :
                                    'text-[#6e6e6e]'
                                }`}>
                                    #{i + 1}
                                </span>
                                <div className="flex-1">
                                    <p className="text-sm text-[#cccccc]">{user.name}</p>
                                    <p className="text-[10px] text-[#6e6e6e]">Level {user.level}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-semibold text-[#4ec9b0]">
                                        {user.balance.toLocaleString()} SB
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-[#6e6e6e] p-4 text-center">
                        {loading ? 'Loading...' : 'No economy data available'}
                    </p>
                )}
            </div>
        </div>
    );
}
