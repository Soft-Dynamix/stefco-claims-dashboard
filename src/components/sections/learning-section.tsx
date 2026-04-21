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
import { Progress } from "@/components/ui/progress";
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
import {
  Brain,
  Database,
  Users,
  Ban,
  TrendingUp,
  Plus,
  Search,
  RefreshCw,
  MessageSquare,
  XCircle,
  Lightbulb,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LearningStats {
  stats: {
    totalPatterns: number;
    totalKnowledge: number;
    totalSenderProfiles: number;
    totalIgnoreRules: number;
    avgConfidence: number;
  };
  automationLevels: Array<{ level: string; count: number }>;
  topSenders: Array<{
    id: string;
    senderDomain: string;
    totalEmails: number;
    newClaimCount: number;
    accuracyRate: number;
    automationLevel: string;
  }>;
  recentPatterns: Array<{
    id: string;
    senderDomain: string;
    fieldName: string;
    patternHint: string;
    confidence: number;
    correctionCount: number;
    insuranceCompany: { name: string } | null;
  }>;
}

interface LearningPattern {
  id: string;
  senderDomain: string;
  fieldName: string;
  patternHint: string;
  exampleOriginal: string | null;
  exampleCorrected: string | null;
  confidence: number;
  correctionCount: number;
  insuranceCompany: { name: string } | null;
}

interface SenderPattern {
  id: string;
  senderDomain: string;
  totalEmails: number;
  newClaimCount: number;
  ignoreCount: number;
  accuracyRate: number;
  automationLevel: string;
  confidenceScore: number;
}

interface RejectionFeedbackItem {
  id: string;
  emailQueueId: string;
  rejectionCategory: string;
  rejectionReason: string | null;
  isFollowUp: boolean;
  relatedClaimId: string | null;
  applyToSender: boolean;
  suggestedRule: string | null;
  emailSubject: string | null;
  emailFrom: string | null;
  emailFromDomain: string | null;
  originalClassification: string | null;
  originalConfidence: number | null;
  createdAt: string;
}

interface ThreadPatternItem {
  id: string;
  senderDomain: string;
  subjectPrefix: string | null;
  normalizedSubject: string | null;
  followUpCount: number;
  newClaimCount: number;
  isFollowUpProbability: number;
}

export function LearningSection() {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [patterns, setPatterns] = useState<LearningPattern[]>([]);
  const [senders, setSenders] = useState<SenderPattern[]>([]);
  const [rejectionFeedback, setRejectionFeedback] = useState<RejectionFeedbackItem[]>([]);
  const [threadPatterns, setThreadPatterns] = useState<ThreadPatternItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const { toast } = useToast();

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (activeTab === "patterns") fetchPatterns();
    if (activeTab === "senders") fetchSenders();
    if (activeTab === "feedback") fetchRejectionFeedback();
    if (activeTab === "threads") fetchThreadPatterns();
  }, [activeTab]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/learning?type=stats");
      const json = await res.json();
      setStats(json);
    } catch (error) {
      console.error("Failed to fetch learning stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPatterns = async () => {
    try {
      const res = await fetch("/api/learning?type=patterns");
      const json = await res.json();
      setPatterns(json);
    } catch (error) {
      console.error("Failed to fetch patterns:", error);
    }
  };

  const fetchSenders = async () => {
    try {
      const res = await fetch("/api/learning?type=senders");
      const json = await res.json();
      setSenders(json);
    } catch (error) {
      console.error("Failed to fetch senders:", error);
    }
  };

  const fetchRejectionFeedback = async () => {
    try {
      const res = await fetch("/api/rejection-feedback?limit=100");
      const json = await res.json();
      setRejectionFeedback(json);
    } catch (error) {
      console.error("Failed to fetch rejection feedback:", error);
    }
  };

  const fetchThreadPatterns = async () => {
    try {
      const res = await fetch("/api/thread-patterns");
      const json = await res.json();
      setThreadPatterns(json);
    } catch (error) {
      console.error("Failed to fetch thread patterns:", error);
    }
  };

  const getAutomationLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      manual: "bg-red-500",
      semi_auto: "bg-yellow-500",
      auto: "bg-green-500",
    };
    return colors[level] || "bg-gray-500";
  };

  const getAutomationLevelBadge = (level: string) => {
    const variants: Record<string, "destructive" | "secondary" | "default"> = {
      manual: "destructive",
      semi_auto: "secondary",
      auto: "default",
    };
    return (
      <Badge variant={variants[level] || "outline"}>
        {level.replace("_", " ").toUpperCase()}
      </Badge>
    );
  };

  const getCategoryBadge = (category: string) => {
    const colors: Record<string, string> = {
      follow_up: "bg-blue-500",
      duplicate: "bg-orange-500",
      not_a_claim: "bg-gray-500",
      spam: "bg-red-500",
      marketing: "bg-purple-500",
      wrong_sender: "bg-yellow-500",
      already_processed: "bg-orange-500",
      test_email: "bg-cyan-500",
      other: "bg-gray-400",
    };
    return (
      <Badge className={colors[category] || "bg-gray-500"}>
        {category.replace("_", " ")}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Learning Engine</h1>
          <p className="text-muted-foreground">
            AI learning patterns and sender profiles
          </p>
        </div>
        <Button onClick={fetchStats} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Learning Patterns</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.stats?.totalPatterns || 0}</div>
            <p className="text-xs text-muted-foreground">Extraction rules learned</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sender Profiles</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.stats?.totalSenderProfiles || 0}</div>
            <p className="text-xs text-muted-foreground">Known senders tracked</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Confidence</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(stats?.stats?.avgConfidence || 0).toFixed(0)}%
            </div>
            <Progress value={stats?.stats?.avgConfidence || 0} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ignore Rules</CardTitle>
            <Ban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.stats?.totalIgnoreRules || 0}</div>
            <p className="text-xs text-muted-foreground">Auto-ignore rules</p>
          </CardContent>
        </Card>
      </div>

      {/* How Learning Works */}
      <Card className="border-green-500/30 bg-green-500/5">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-green-500" />
            How the System Learns
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="space-y-2">
              <div className="font-medium flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">1</span>
                You Provide Feedback
              </div>
              <p className="text-muted-foreground pl-8">
                When you reject an email with a reason, the system captures what went wrong and why.
              </p>
            </div>
            <div className="space-y-2">
              <div className="font-medium flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-yellow-500 text-white flex items-center justify-center text-xs">2</span>
                Patterns Are Created
              </div>
              <p className="text-muted-foreground pl-8">
                The system creates rules like "Re: emails from santam.co.za are usually follow-ups, not new claims".
              </p>
            </div>
            <div className="space-y-2">
              <div className="font-medium flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs">3</span>
                Future Decisions Improve
              </div>
              <p className="text-muted-foreground pl-8">
                Next time a similar email arrives, the AI uses learned patterns to make better decisions.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Automation Levels */}
      <Card>
        <CardHeader>
          <CardTitle>Automation Level Distribution</CardTitle>
          <CardDescription>
            How senders are categorized for processing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-8">
            {stats?.automationLevels.map((level) => (
              <div key={level.level} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getAutomationLevelColor(level.level)}`} />
                <span className="capitalize">{level.level.replace("_", " ")}</span>
                <Badge variant="secondary">{level.count}</Badge>
              </div>
            ))}
          </div>
          
          <Separator className="my-4" />
          
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <Badge variant="destructive">MANUAL</Badge>
              <p className="mt-1 text-muted-foreground">
                &lt; 6 patterns OR &lt; 70% accuracy
              </p>
            </div>
            <div>
              <Badge variant="secondary">SEMI-AUTO</Badge>
              <p className="mt-1 text-muted-foreground">
                ≥ 6 patterns AND ≥ 70% accuracy
              </p>
            </div>
            <div>
              <Badge variant="default">AUTO</Badge>
              <p className="mt-1 text-muted-foreground">
                ≥ 10 patterns AND ≥ 85% accuracy
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Top Senders</TabsTrigger>
          <TabsTrigger value="feedback">Rejection Feedback</TabsTrigger>
          <TabsTrigger value="threads">Thread Detection</TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
          <TabsTrigger value="senders">All Senders</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Top Sender Domains</CardTitle>
              <CardDescription>
                Most active email senders by volume
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Total Emails</TableHead>
                    <TableHead>Claims</TableHead>
                    <TableHead>Accuracy</TableHead>
                    <TableHead>Level</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats?.topSenders.map((sender) => (
                    <TableRow key={sender.id}>
                      <TableCell className="font-medium">{sender.senderDomain}</TableCell>
                      <TableCell>{sender.totalEmails}</TableCell>
                      <TableCell>{sender.newClaimCount}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={sender.accuracyRate} className="w-16" />
                          {sender.accuracyRate.toFixed(0)}%
                        </div>
                      </TableCell>
                      <TableCell>{getAutomationLevelBadge(sender.automationLevel)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Recent Learning Patterns</CardTitle>
              <CardDescription>
                Latest patterns learned from corrections
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Pattern Hint</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Corrections</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats?.recentPatterns.map((pattern) => (
                    <TableRow key={pattern.id}>
                      <TableCell className="font-medium">{pattern.senderDomain}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{pattern.fieldName}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate">
                        {pattern.patternHint}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pattern.confidence} className="w-16" />
                          {pattern.confidence}%
                        </div>
                      </TableCell>
                      <TableCell>{pattern.correctionCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                Rejection Feedback History
              </CardTitle>
              <CardDescription>
                Learn from why emails were rejected - this teaches the AI to improve
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                {rejectionFeedback.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No rejection feedback yet. When you reject emails with reasons, they will appear here.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>AI Thought</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rejectionFeedback.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-sm">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {item.emailSubject || "-"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getCategoryBadge(item.rejectionCategory)}
                              {item.isFollowUp && (
                                <MessageSquare className="h-3 w-3 text-blue-500" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                            {item.rejectionReason || "-"}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <Badge variant="outline">{item.originalClassification || "N/A"}</Badge>
                              {item.originalConfidence !== null && (
                                <span className="text-muted-foreground ml-1">
                                  ({item.originalConfidence.toFixed(0)}%)
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {item.applyToSender && (
                              <Badge variant="secondary" className="text-xs">
                                Rule Created
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="threads" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-blue-500" />
                Thread Detection Patterns
              </CardTitle>
              <CardDescription>
                Learn to distinguish follow-up emails from new claims based on subject patterns
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                {threadPatterns.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No thread patterns learned yet. When you mark emails as follow-ups, patterns will appear here.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>Prefix</TableHead>
                        <TableHead>Normalized Subject</TableHead>
                        <TableHead>Follow-ups</TableHead>
                        <TableHead>New Claims</TableHead>
                        <TableHead>P(Follow-up)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {threadPatterns.map((pattern) => (
                        <TableRow key={pattern.id}>
                          <TableCell className="font-medium">{pattern.senderDomain}</TableCell>
                          <TableCell>
                            {pattern.subjectPrefix ? (
                              <Badge variant="outline">{pattern.subjectPrefix}:</Badge>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="max-w-[250px] truncate">
                            {pattern.normalizedSubject || "-"}
                          </TableCell>
                          <TableCell>{pattern.followUpCount}</TableCell>
                          <TableCell>{pattern.newClaimCount}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress 
                                value={pattern.isFollowUpProbability * 100} 
                                className="w-16" 
                              />
                              {(pattern.isFollowUpProbability * 100).toFixed(0)}%
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="patterns" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>All Learning Patterns</CardTitle>
                  <CardDescription>
                    Extraction rules learned from user corrections
                  </CardDescription>
                </div>
                <div className="w-64">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search patterns..."
                      className="pl-8"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Pattern Hint</TableHead>
                      <TableHead>Example</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Corrections</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patterns
                      .filter((p) =>
                        searchQuery
                          ? p.senderDomain.includes(searchQuery) ||
                            p.fieldName.includes(searchQuery)
                          : true
                      )
                      .map((pattern) => (
                        <TableRow key={pattern.id}>
                          <TableCell className="font-medium">{pattern.senderDomain}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{pattern.fieldName}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            {pattern.patternHint}
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            {pattern.exampleOriginal && (
                              <div className="text-xs">
                                <span className="text-muted-foreground line-through">
                                  {pattern.exampleOriginal}
                                </span>
                                {" → "}
                                <span className="text-green-600">
                                  {pattern.exampleCorrected}
                                </span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Progress value={pattern.confidence} className="w-16" />
                          </TableCell>
                          <TableCell>{pattern.correctionCount}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="senders" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>All Sender Profiles</CardTitle>
              <CardDescription>
                Complete list of known email senders
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead>Total Emails</TableHead>
                      <TableHead>Claims</TableHead>
                      <TableHead>Ignored</TableHead>
                      <TableHead>Accuracy</TableHead>
                      <TableHead>Confidence Score</TableHead>
                      <TableHead>Level</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {senders.map((sender) => (
                      <TableRow key={sender.id}>
                        <TableCell className="font-medium">{sender.senderDomain}</TableCell>
                        <TableCell>{sender.totalEmails}</TableCell>
                        <TableCell>{sender.newClaimCount}</TableCell>
                        <TableCell>{sender.ignoreCount}</TableCell>
                        <TableCell>
                          <Progress value={sender.accuracyRate} className="w-16" />
                        </TableCell>
                        <TableCell>{sender.confidenceScore.toFixed(0)}</TableCell>
                        <TableCell>{getAutomationLevelBadge(sender.automationLevel)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
