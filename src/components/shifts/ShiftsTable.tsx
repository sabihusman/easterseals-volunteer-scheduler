import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Trash2, StickyNote, UserPlus } from "lucide-react";
import type { Shift } from "@/hooks/useShiftsList";

interface Props {
  shifts: Shift[];
  onEdit: (shift: Shift) => void;
  onDelete: (shiftId: string) => void;
  onInvite: (shift: Shift) => void;
}

/**
 * Read-only table of shifts with per-row Invite / Edit / Delete buttons.
 *
 * Completed shifts have Edit and Delete disabled because the DB enforces
 * immutability via `enforce_completed_shift_immutability` and
 * `prevent_delete_bookings_on_completed_shifts` triggers — clicking either
 * would only return a 500.
 */
export function ShiftsTable({ shifts, onEdit, onDelete, onInvite }: Props) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Department</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead className="text-center">Max</TableHead>
            <TableHead className="text-center">Note</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shifts.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                No shifts yet. Create one to get started.
              </TableCell>
            </TableRow>
          )}
          {shifts.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.departments?.name ?? "—"}</TableCell>
              <TableCell>{s.shift_date}</TableCell>
              <TableCell>
                {s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)}
              </TableCell>
              <TableCell className="text-center">{s.total_slots}</TableCell>
              <TableCell className="text-center">
                {s.coordinator_note ? (
                  <StickyNote className="mx-auto h-4 w-4 text-primary" />
                ) : (
                  <span className="text-muted-foreground/40">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => onInvite(s)} title="Invite volunteer" aria-label="Invite volunteer">
                    <UserPlus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(s)}
                    disabled={s.status === "completed"}
                    title={s.status === "completed" ? "Completed shifts cannot be edited" : undefined}
                    aria-label="Edit shift"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => onDelete(s.id)}
                    disabled={s.status === "completed"}
                    title={s.status === "completed" ? "Completed shifts cannot be deleted" : undefined}
                    aria-label="Delete shift"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
