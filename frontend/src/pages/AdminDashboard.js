import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield, Users, MessageSquare, AlertTriangle, Activity,
  ArrowLeft, RefreshCw, CheckCircle, XCircle, Loader2
} from "lucide-react";

const DASH_BG = "https://static.prod-images.emergentagent.com/jobs/cafcabc8-c2cd-4ce2-9178-486ea0ee313b/images/4308fac628c2fd6f3ef08f86c59a66067a51ac03fc7f13e23193a1bfd98ae0c1.png";

function formatDate(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatCard({ title, value, icon: Icon, color = "#10B981", subtitle }) {
  return (
    <Card className="bg-[#121821] border-white/5 rounded-xl hover:border-[#10B981]/20 transition-all duration-300">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[#94A3B8] text-xs uppercase tracking-wider font-jetbrains mb-2">{title}</p>
            <p className="text-3xl font-bold font-outfit" style={{ color }}>{value}</p>
            {subtitle && <p className="text-[#64748B] text-xs mt-1">{subtitle}</p>}
          </div>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [statsRes, usersRes, logsRes] = await Promise.all([
        api.get("/api/admin/stats"),
        api.get("/api/admin/users"),
        api.get("/api/admin/login-logs"),
      ]);
      setStats(statsRes.data);
      setUsers(usersRes.data.users);
      setLogs(logsRes.data.logs);
    } catch (err) {
      console.error("Admin data load failed:", err);
    } finally {
      setLoadingData(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0F14]">
        <Loader2 className="w-8 h-8 text-[#10B981] animate-spin" />
      </div>
    );
  }

  const failedLoginLogs = logs.filter((l) => !l.success);
  const suspiciousActivity = failedLoginLogs.length > 10;

  return (
    <div className="min-h-screen bg-[#0B0F14]" data-testid="admin-dashboard">
      {/* Header */}
      <div className="relative border-b border-white/5">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: `url(${DASH_BG})`, backgroundSize: "cover" }} />
        <div className="relative px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              data-testid="admin-back-button"
              variant="ghost"
              size="icon"
              onClick={() => navigate("/chat")}
              className="text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/5 h-9 w-9"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-[#F8FAFC] font-outfit flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#10B981]" />
                Admin Dashboard
              </h1>
              <p className="text-[#94A3B8] text-xs mt-0.5">System monitoring &amp; security overview</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              data-testid="refresh-dashboard-button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="border-white/10 text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/5"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              data-testid="admin-logout-button"
              variant="ghost"
              size="sm"
              onClick={() => { logout(); navigate("/login"); }}
              className="text-[#94A3B8] hover:text-[#F8FAFC]"
            >
              Logout
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" data-testid="stats-grid">
          <StatCard title="Total Users" value={stats?.total_users || 0} icon={Users} color="#10B981" />
          <StatCard title="Online Now" value={stats?.online_users || 0} icon={Activity} color="#3B82F6" subtitle="Active connections" />
          <StatCard title="Messages" value={stats?.total_messages || 0} icon={MessageSquare} color="#8B5CF6" />
          <StatCard
            title="Failed Logins (24h)"
            value={stats?.recent_failed_logins_24h || 0}
            icon={AlertTriangle}
            color={stats?.recent_failed_logins_24h > 5 ? "#EF4444" : "#F59E0B"}
            subtitle={`${stats?.total_failed_logins || 0} total`}
          />
        </div>

        {/* Alert */}
        {suspiciousActivity && (
          <Card className="bg-[#EF4444]/10 border-[#EF4444]/30 rounded-xl mb-6" data-testid="suspicious-alert">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-[#EF4444] shrink-0" />
              <div>
                <p className="text-[#F8FAFC] text-sm font-semibold">Suspicious Activity Detected</p>
                <p className="text-[#94A3B8] text-xs">High number of failed login attempts ({failedLoginLogs.length}). Review login logs.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="users" className="space-y-4" data-testid="admin-tabs">
          <TabsList className="bg-[#121821] border border-white/5 p-1 rounded-xl">
            <TabsTrigger
              value="users"
              data-testid="tab-users"
              className="data-[state=active]:bg-[#10B981] data-[state=active]:text-[#0B0F14] text-[#94A3B8] rounded-lg text-sm"
            >
              <Users className="w-4 h-4 mr-1.5" /> Users
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              data-testid="tab-logs"
              className="data-[state=active]:bg-[#10B981] data-[state=active]:text-[#0B0F14] text-[#94A3B8] rounded-lg text-sm"
            >
              <Activity className="w-4 h-4 mr-1.5" /> Login Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card className="bg-[#121821] border-white/5 rounded-xl" data-testid="users-table-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-[#F8FAFC] text-base font-outfit">Registered Users</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/5 hover:bg-transparent">
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">Name</TableHead>
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">Email</TableHead>
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">Role</TableHead>
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">Status</TableHead>
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">Verified</TableHead>
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">Joined</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id} className="border-white/5 hover:bg-white/[0.02]" data-testid={`user-row-${u.id}`}>
                          <TableCell className="text-[#F8FAFC] text-sm font-medium">{u.name}</TableCell>
                          <TableCell className="text-[#94A3B8] text-sm">{u.email}</TableCell>
                          <TableCell>
                            <Badge
                              className={`text-[10px] font-jetbrains ${
                                u.role === "admin"
                                  ? "bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30"
                                  : "bg-white/5 text-[#94A3B8] border-white/10"
                              }`}
                              variant="outline"
                            >
                              {u.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${u.is_online ? "bg-[#10B981]" : "bg-[#64748B]"}`} />
                              <span className={`text-xs ${u.is_online ? "text-[#10B981]" : "text-[#64748B]"}`}>
                                {u.is_online ? "Online" : "Offline"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {u.is_verified
                              ? <CheckCircle className="w-4 h-4 text-[#10B981]" />
                              : <XCircle className="w-4 h-4 text-[#EF4444]" />
                            }
                          </TableCell>
                          <TableCell className="text-[#94A3B8] text-xs font-jetbrains">{formatDate(u.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs">
            <Card className="bg-[#121821] border-white/5 rounded-xl" data-testid="logs-table-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-[#F8FAFC] text-base font-outfit">Login Activity</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/5 hover:bg-transparent">
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">Email</TableHead>
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">Action</TableHead>
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">Status</TableHead>
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">IP</TableHead>
                        <TableHead className="text-[#94A3B8] text-xs font-jetbrains uppercase">Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log, i) => (
                        <TableRow key={i} className="border-white/5 hover:bg-white/[0.02]" data-testid={`log-row-${i}`}>
                          <TableCell className="text-[#F8FAFC] text-sm">{log.email || "-"}</TableCell>
                          <TableCell>
                            <Badge
                              className="text-[10px] font-jetbrains bg-white/5 border-white/10 text-[#94A3B8]"
                              variant="outline"
                            >
                              {log.action}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {log.success
                              ? <Badge className="bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30 text-[10px]" variant="outline">Success</Badge>
                              : <Badge className="bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30 text-[10px]" variant="outline">Failed</Badge>
                            }
                          </TableCell>
                          <TableCell className="text-[#94A3B8] text-xs font-jetbrains">{log.ip || "-"}</TableCell>
                          <TableCell className="text-[#94A3B8] text-xs font-jetbrains">{formatDate(log.timestamp)}</TableCell>
                        </TableRow>
                      ))}
                      {logs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-[#94A3B8] py-8">No login activity yet</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
