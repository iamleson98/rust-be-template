import 'package:flutter/foundation.dart';

/// The authenticated user, mirroring the backend's `SessionUser` JSON shape
/// (camelCase; the actor type is serialized under the key `"type"`).
@immutable
class SessionUser {
  const SessionUser({
    required this.id,
    required this.type,
    required this.role,
    required this.name,
    this.email,
    this.phone,
    this.avatarUrl,
    this.brandId,
    this.brandName,
    this.employeeRole,
  });

  final String id;

  /// `"user" | "employee" | "admin"` — the backend calls this `actor_type`
  /// and serializes it as `"type"`.
  final String type;
  final String role;
  final String name;
  final String? email;
  final String? phone;
  final String? avatarUrl;
  final String? brandId;
  final String? brandName;
  final String? employeeRole;

  bool get isStaff => type == 'employee' || type == 'admin';
  bool get isAdmin => type == 'admin';

  factory SessionUser.fromJson(Map<String, dynamic> json) => SessionUser(
        id: json['id'] as String,
        type: (json['type'] ?? json['actorType'] ?? 'user') as String,
        role: (json['role'] ?? 'user') as String,
        name: (json['name'] ?? '') as String,
        email: json['email'] as String?,
        phone: json['phone'] as String?,
        avatarUrl: json['avatarUrl'] as String?,
        brandId: json['brandId'] as String?,
        brandName: json['brandName'] as String?,
        employeeRole: json['employeeRole'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'role': role,
        'name': name,
        'email': email,
        'phone': phone,
        'avatarUrl': avatarUrl,
        'brandId': brandId,
        'brandName': brandName,
        'employeeRole': employeeRole,
      };
}

/// Full auth session state held in memory by [AuthController].
@immutable
class AuthState {
  const AuthState({this.user, this.accessToken, this.refreshToken});

  static const empty = AuthState();

  final SessionUser? user;
  final String? accessToken;
  final String? refreshToken;

  bool get isLoggedIn => user != null && accessToken != null;
}
