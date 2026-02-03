import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Upload, 
  Trash2, 
  Loader2, 
  ImageIcon, 
  AlertCircle,
  Check 
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const BUCKET_NAME = "owner-photos";
const MAX_PHOTOS = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

interface OwnerPhoto {
  name: string;
  url: string;
}

/**
 * Component for managing owner reference photos for AI cover generation
 * Limits: max 10 photos, 5MB each, jpg/png/webp
 */
export function OwnerPhotosUploader() {
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  // Fetch existing photos
  const { data: photos, isLoading } = useQuery({
    queryKey: ["owner-photos"],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .list("", { 
          limit: MAX_PHOTOS,
          sortBy: { column: "created_at", order: "desc" }
        });
      
      if (error) {
        console.error("Error listing photos:", error);
        return [];
      }
      
      // Get public URLs for each file
      const photosWithUrls: OwnerPhoto[] = (data || [])
        .filter(f => !f.name.startsWith(".")) // Skip hidden files
        .map(file => {
          const { data: urlData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(file.name);
          return {
            name: file.name,
            url: urlData.publicUrl,
          };
        });
      
      return photosWithUrls;
    },
  });

  // Handle file upload
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    
    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Неподдерживаемый формат. Используйте JPG, PNG или WebP");
      return;
    }
    
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast.error("Файл слишком большой. Максимум 5 МБ");
      return;
    }
    
    // Check photo limit
    if (photos && photos.length >= MAX_PHOTOS) {
      toast.error(`Достигнут лимит (${MAX_PHOTOS} фото). Удалите старые для загрузки новых`);
      return;
    }
    
    setIsUploading(true);
    
    try {
      // Generate unique filename
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `photo-${Date.now()}.${ext}`;
      
      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, file, {
          contentType: file.type,
          upsert: false,
        });
      
      if (error) {
        throw error;
      }
      
      toast.success("Фото загружено");
      queryClient.invalidateQueries({ queryKey: ["owner-photos"] });
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error(`Ошибка загрузки: ${error.message}`);
    } finally {
      setIsUploading(false);
      // Reset file input
      e.target.value = "";
    }
  }, [photos, queryClient]);

  // Handle photo deletion
  const handleDelete = useCallback(async (fileName: string) => {
    setDeletingFile(fileName);
    
    try {
      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([fileName]);
      
      if (error) throw error;
      
      toast.success("Фото удалено");
      queryClient.invalidateQueries({ queryKey: ["owner-photos"] });
    } catch (error: any) {
      console.error("Delete error:", error);
      toast.error(`Ошибка удаления: ${error.message}`);
    } finally {
      setDeletingFile(null);
    }
  }, [queryClient]);

  const canUpload = !photos || photos.length < MAX_PHOTOS;

  return (
    <div className="space-y-4">
      {/* Info */}
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <ImageIcon className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          Загрузите фото владельца для AI-генерации обложек. 
          При генерации будет выбрано случайное фото как основа для стилизации.
        </p>
      </div>

      {/* Photos grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : photos && photos.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {photos.map((photo) => (
            <div 
              key={photo.name}
              className="relative group aspect-square rounded-lg overflow-hidden border border-border/50 bg-muted/30"
            >
              <img 
                src={photo.url} 
                alt="Reference" 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleDelete(photo.name)}
                  disabled={deletingFile === photo.name}
                >
                  {deletingFile === photo.name ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/50 p-6 text-center text-muted-foreground">
          <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Нет загруженных фотографий</p>
          <p className="text-xs mt-1">Рекомендуется 3-5 качественных фото</p>
        </div>
      )}

      {/* Upload button */}
      <div className="flex items-center gap-3">
        <Label 
          htmlFor="owner-photo-upload"
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors",
            canUpload 
              ? "border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary" 
              : "border-muted bg-muted/50 text-muted-foreground cursor-not-allowed"
          )}
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          <span className="text-sm font-medium">
            {isUploading ? "Загрузка..." : "Загрузить фото"}
          </span>
        </Label>
        <Input
          id="owner-photo-upload"
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          onChange={handleUpload}
          disabled={isUploading || !canUpload}
          className="hidden"
        />
        
        <span className="text-xs text-muted-foreground">
          {photos?.length || 0} / {MAX_PHOTOS} • JPG, PNG, WebP • до 5 МБ
        </span>
      </div>

      {/* Warning if at limit */}
      {photos && photos.length >= MAX_PHOTOS && (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <AlertDescription className="text-sm">
            Достигнут лимит фотографий. Удалите старые для загрузки новых.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
