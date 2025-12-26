import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface RemoveRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  roleName: string;
  userEmail: string;
}

export function RemoveRoleDialog({ 
  open, 
  onOpenChange, 
  onConfirm, 
  roleName, 
  userEmail 
}: RemoveRoleDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить роль?</AlertDialogTitle>
          <AlertDialogDescription>
            Вы уверены, что хотите удалить роль <strong>"{roleName}"</strong> у пользователя <strong>{userEmail}</strong>?
            <br /><br />
            После удаления роли пользователь станет обычным пользователем.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Удалить</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
