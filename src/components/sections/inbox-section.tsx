"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Mail,
  Search,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  Brain,
  RefreshCw,
  Play,
  Square,
  Download,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Email {
  id: string;
  messageId: string;
  subject: string | null;
  from: string | null;
  fromDomain: string | null;
  bodyText: string | null;
  aiClassification: string | null;
  aiConfidence: number | null;
  aiReasoning: string | null;
  aiExtractedData: string | null;
  status: string;
  processingRoute: string | null;
  learningHintsCount: number;
  receivedAt: string;
  processedAt: string | null;
}

interface PollingStatus {
  isConfigured: boolean;
  lastPoll: string | null;
  nextPoll: string | null;
  totalQueued: number;
  schedulerEnabled: boolean;
  pollInterval: number;
}

export function InboxSection() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pollingStatus, setPollingStatus] = useState<PollingStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchEmails();
    fetchPollingStatus();
    // Refresh status every 30 seconds
    const interval = setInterval(fetchPollingStatus, 30000);
    return () => clearInterval(interval);
  }, [statusFilter]);

  const fetchEmails = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/email-inbox?status=${statusFilter}`);
      const json = await res.json();
      setEmails(json.emails || []);
    } catch (error) {
      console.error("Failed to fetch emails:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPollingStatus = async () => {
    try {
      const res = await fetch("/api/email-poll");
      const json = await res.json();
      setPollingStatus(json);
    } catch (error) {
      console.error("Failed to fetch polling status:", error);
    }
  };

  const pollEmailsNow = async () => {
    setIsPolling(true);
    toast({
      title: "Polling Emails",
      description: "Connecting to IMAP server...",
    });

    try {
      const res = await fetch("/api/email-poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });

      const json = await res.json();

      if (json.success) {
        toast({
          title: "Success",
          description: json.message || `Fetched ${json.fetched} new emails`,
        });
        fetchEmails();
        fetchPollingStatus();
      } else {
        toast({
          title: "Polling Failed",
          description: json.errors?.[0] || "Failed to fetch emails",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to poll emails",
        variant: "destructive",
      });
    } finally {
      setIsPolling(false);
    }
  };

  const toggleScheduler = async (enable: boolean) => {
    try {
      const res = await fetch("/api/email-poll/scheduler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: enable ? "start" : "stop",
          interval: pollingStatus?.pollInterval || 5,
        }),
      });

      const json = await res.json();

      if (json.success) {
        toast({
          title: enable ? "Scheduler Started" : "Scheduler Stopped",
          description: json.message,
        });
        fetchPollingStatus();
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update scheduler",
        variant: "destructive",
      });
    }
  };

  const viewEmail = (email: Email) => {
    setSelectedEmail(email);
    setDetailsOpen(true);
  };

  const classifyEmail = async (emailId: string, classification: string) => {
    try {
      const res = await fetch(`/api/email-inbox/${emailId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: classification === "NEW_CLAIM" ? "CLAIM_CREATED" : "IGNORED",
        }),
      });

      if (res.ok) {
        toast({
          title: "Success",
          description: `Email ${classification === "NEW_CLAIM" ? "accepted as claim" : "ignored"}`,
        });
        fetchEmails();
        setDetailsOpen(false);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update email",
        variant: "destructive",
      });
    }
  };

  const createClaimFromEmail = async (email: Email) => {
    // Parse extracted data
    let extractedData: Record<string, unknown> = {};
    try {
      extractedData = email.aiExtractedData ? JSON.parse(email.aiExtractedData) : {};
    } catch {
      extractedData = {};
    }

    // Create claim
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimNumber: (extractedData.claimNumber as string) || `PENDING-${Date.now()}`,
          clientName: extractedData.clientName,
          clientEmail: extractedData.clientEmail,
          clientPhone: extractedData.clientPhone,
          claimType: extractedData.claimType,
          incidentDescription: extractedData.incidentDescription,
          vehicleRegistration: extractedData.vehicleRegistration,
          sourceEmailId: email.id,
          sourceEmailSubject: email.subject,
          sourceEmailFrom: email.from,
          status: "NEW",
        }),
      });

      if (res.ok) {
        // Update email status
        await fetch(`/api/email-inbox/${email.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "CLAIM_CREATED" }),
        });

        toast({
          title: "Success",
          description: "Claim created successfully",
        });
        fetchEmails();
        setDetailsOpen(false);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create claim",
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      PENDING: "secondary",
      AI_ANALYZED: "default",
      USER_REVIEWING: "outline",
      CLAIM_CREATED: "default",
      IGNORED: "destructive",
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  const getClassificationBadge = (classification: string | null) => {
    if (!classification) return <Badge variant="outline">Unanalyzed</Badge>;
    
    const colors: Record<string, string> = {
      NEW_CLAIM: "bg-green-500",
      IGNORE: "bg-gray-500",
      MISSING_INFO: "bg-yellow-500",
      OTHER: "bg-blue-500",
    };

    return (
      <Badge className={colors[classification] || "bg-gray-500"}>
        {classification}
      </Badge>
    );
  };

  const filteredEmails = emails.filter((email) => {
    if (!searchQuery) return true;
    return (
      email.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.fromDomain?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Email Inbox</h1>
          <p className="text-muted-foreground">
            Review and process incoming claim emails
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchEmails} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Polling Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Email Polling
              </CardTitle>
              <CardDescription>
                IMAP email fetching and scheduling
              </CardDescription>
            </div>
            <div className="flex items-center gap-4">
              {pollingStatus?.isConfigured ? (
                <Badge className="bg-green-500 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Not Configured
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Queued Emails</p>
              <p className="text-2xl font-bold">{pollingStatus?.totalQueued || 0}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Last Poll</p>
              <p className="text-sm font-medium">
                {pollingStatus?.lastPoll
                  ? new Date(pollingStatus.lastPoll).toLocaleString()
                  : "Never"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Poll Interval</p>
              <p className="text-sm font-medium">
                Every {pollingStatus?.pollInterval || 5} minutes
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Auto-Poller</p>
              <p className="text-sm font-medium flex items-center gap-2">
                {pollingStatus?.schedulerEnabled ? (
                  <><Play className="h-3 w-3 text-green-500" /> Running</>
                ) : (
                  <><Square className="h-3 w-3 text-gray-500" /> Stopped</>
                )}
              </p>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                onClick={pollEmailsNow}
                disabled={isPolling || !pollingStatus?.isConfigured}
                className="min-w-[150px]"
              >
                {isPolling ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Polling...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Poll Emails Now
                  </>
                )}
              </Button>

              {!pollingStatus?.isConfigured && (
                <p className="text-sm text-muted-foreground">
                  Configure IMAP settings to enable polling
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Label htmlFor="scheduler" className="text-sm">
                Auto-Poll
              </Label>
              <Switch
                id="scheduler"
                checked={pollingStatus?.schedulerEnabled || false}
                onCheckedChange={toggleScheduler}
                disabled={!pollingStatus?.isConfigured}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search emails..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="AI_ANALYZED">AI Analyzed</SelectItem>
            <SelectItem value="USER_REVIEWING">User Reviewing</SelectItem>
            <SelectItem value="CLAIM_CREATED">Claim Created</SelectItem>
            <SelectItem value="IGNORED">Ignored</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Email List */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>From</TableHead>
                <TableHead>AI Classification</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredEmails.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No emails found. Click "Poll Emails Now" to fetch new emails.
                  </TableCell>
                </TableRow>
              ) : (
                filteredEmails.map((email) => (
                  <TableRow key={email.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {email.subject || "(No Subject)"}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate">
                      {email.from || "-"}
                    </TableCell>
                    <TableCell>{getClassificationBadge(email.aiClassification)}</TableCell>
                    <TableCell>
                      {email.aiConfidence !== null ? (
                        <div className="flex items-center gap-1">
                          <Brain className="h-3 w-3" />
                          {email.aiConfidence.toFixed(0)}%
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(email.status)}</TableCell>
                    <TableCell>
                      {new Date(email.receivedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => viewEmail(email)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Email Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Email Details</DialogTitle>
            <DialogDescription>
              Review and process this email
            </DialogDescription>
          </DialogHeader>
          
          {selectedEmail && (
            <Tabs defaultValue="content" className="mt-4">
              <TabsList>
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="ai">AI Analysis</TabsTrigger>
                <TabsTrigger value="actions">Actions</TabsTrigger>
              </TabsList>
              
              <TabsContent value="content" className="mt-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">From</Label>
                      <p className="font-medium">{selectedEmail.from || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Domain</Label>
                      <p className="font-medium">{selectedEmail.fromDomain || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Subject</Label>
                      <p className="font-medium">{selectedEmail.subject || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Received</Label>
                      <p className="font-medium">
                        {new Date(selectedEmail.receivedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div>
                    <Label className="text-muted-foreground">Body</Label>
                    <ScrollArea className="h-64 mt-2 rounded border p-4">
                      <pre className="text-sm whitespace-pre-wrap">
                        {selectedEmail.bodyText || "(No content)"}
                      </pre>
                    </ScrollArea>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="ai" className="mt-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Classification</Label>
                      <div className="mt-1">
                        {getClassificationBadge(selectedEmail.aiClassification)}
                      </div>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Confidence</Label>
                      <p className="font-medium mt-1">
                        {selectedEmail.aiConfidence !== null
                          ? `${selectedEmail.aiConfidence.toFixed(1)}%`
                          : "Not analyzed"}
                      </p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Processing Route</Label>
                      <p className="font-medium mt-1">
                        {selectedEmail.processingRoute || "-"}
                      </p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Learning Hints Used</Label>
                      <p className="font-medium mt-1">
                        {selectedEmail.learningHintsCount}
                      </p>
                    </div>
                  </div>
                  
                  <div>
                    <Label className="text-muted-foreground">AI Reasoning</Label>
                    <ScrollArea className="h-32 mt-2 rounded border p-4">
                      <p className="text-sm">
                        {selectedEmail.aiReasoning || "No reasoning available"}
                      </p>
                    </ScrollArea>
                  </div>
                  
                  <div>
                    <Label className="text-muted-foreground">Extracted Data</Label>
                    <ScrollArea className="h-48 mt-2 rounded border p-4">
                      <pre className="text-sm">
                        {selectedEmail.aiExtractedData
                          ? JSON.stringify(JSON.parse(selectedEmail.aiExtractedData), null, 2)
                          : "No data extracted"}
                      </pre>
                    </ScrollArea>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="actions" className="mt-4">
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Process This Email</CardTitle>
                      <CardDescription>
                        Choose how to handle this email
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <Button
                          className="w-full"
                          onClick={() => createClaimFromEmail(selectedEmail)}
                          disabled={selectedEmail.status === "CLAIM_CREATED"}
                        >
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Create Claim
                        </Button>
                        <Button
                          variant="destructive"
                          className="w-full"
                          onClick={() => classifyEmail(selectedEmail.id, "IGNORE")}
                          disabled={selectedEmail.status === "IGNORED"}
                        >
                          <XCircle className="mr-2 h-4 w-4" />
                          Ignore Email
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Request Analysis</CardTitle>
                      <CardDescription>
                        Request AI to re-analyze this email
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" className="w-full">
                        <Brain className="mr-2 h-4 w-4" />
                        Re-analyze with AI
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
