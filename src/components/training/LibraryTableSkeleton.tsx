import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";

export function LibraryTableSkeleton() {
  return (
    <div className="space-y-3">
      {/* Search bar skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1 rounded-md" />
        <Skeleton className="h-9 w-[130px] rounded-md" />
      </div>

      {/* Table skeleton */}
      <div className="rounded-lg border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead><Skeleton className="h-3 w-16" /></TableHead>
              <TableHead className="hidden sm:table-cell"><Skeleton className="h-3 w-12" /></TableHead>
              <TableHead className="hidden sm:table-cell"><Skeleton className="h-3 w-14" /></TableHead>
              <TableHead><Skeleton className="h-3 w-14" /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Group row */}
            {[1, 2, 3].map((g) => (
              <TableRow key={g} className="bg-muted/10">
                <TableCell colSpan={4} className="py-2.5">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-40 rounded" />
                    <Skeleton className="h-4 w-5 rounded-full" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {/* Root module rows */}
            {[1, 2, 3, 4].map((r) => (
              <TableRow key={`r-${r}`}>
                <TableCell className="py-2">
                  <div className="flex items-center gap-2" style={{ paddingLeft: 16 }}>
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-5 w-1 rounded-full" />
                    <Skeleton className="h-4 w-48 rounded" />
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell"><Skeleton className="h-3 w-6" /></TableCell>
                <TableCell className="hidden sm:table-cell">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-1.5 flex-1 rounded-full" />
                    <Skeleton className="h-3 w-8" />
                  </div>
                </TableCell>
                <TableCell><Skeleton className="h-4 w-16 rounded" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
