package com.gill.web.storage;

import io.minio.MinioClient;
import io.minio.GetPresignedObjectUrlArgs;
import io.minio.http.Method;
import org.springframework.stereotype.Component;

/** Low-level signed download adapter; the caller must authorize the exact immutable key. */
@Component
public class TeamBlobStore {
 public String download(String key) {
  try {
   var client=MinioClient.builder()
    .endpoint(System.getenv().getOrDefault("MINIO_PUBLIC_ENDPOINT","http://localhost:9000"))
    .region("us-east-1")
    .credentials(System.getenv().getOrDefault("MINIO_ROOT_USER","gilladmin"),System.getenv().getOrDefault("MINIO_ROOT_PASSWORD",""))
    .build();
   return client.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
    .bucket(System.getenv().getOrDefault("MINIO_BUCKET","gill-files")).object(key).method(Method.GET).expiry(120).build());
  } catch(Exception error){throw new IllegalStateException("无法生成版本归档下载链接",error);}
 }
}
